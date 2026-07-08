import { analyzeProfile, analyzeRepository, analyzeRestrictedRepository, toSerializable } from "./lib/analyze.js";
import { githubRateLimitFailure } from "./lib/rate-limit.js";

const API = "https://api.github.com";
const API_VERSION = "2026-03-10";
const CACHE_TTL = 5 * 60 * 1000;
const memoryCache = new Map();
const EXTERNAL_ORIGINS = new Set(["https://grep.app", "https://web.archive.org"]);
const OPTIONAL_STATUS_CODES = new Set([401, 403, 404, 409, 422]);

const defaults = {
  token: "",
  commitDepth: 100,
  autoOpen: false,
  cacheMinutes: 5,
  externalOsint: false
};

async function getSettings() {
  const stored = await chrome.storage.local.get(defaults);
  return { ...defaults, ...stored, token: String(stored.token || "").trim() };
}

function cacheKey(path, scope = "public") {
  return `gitscope:${scope}:${path}`;
}

async function readCache(path, ttl, scope) {
  const key = cacheKey(path, scope);
  const inMemory = memoryCache.get(key);
  if (inMemory && Date.now() - inMemory.at < ttl) return inMemory;
  try {
    const value = (await chrome.storage.session.get(key))[key];
    if (value && Date.now() - value.at < ttl) {
      memoryCache.set(key, value);
      return value;
    }
  } catch {}
  return null;
}

async function writeCache(path, value, scope) {
  const key = cacheKey(path, scope);
  const entry = { at: Date.now(), value };
  memoryCache.set(key, entry);
  try {
    await chrome.storage.session.set({ [key]: entry });
  } catch {}
}

function rateFrom(response) {
  return {
    limit: Number(response.headers.get("x-ratelimit-limit") || 0),
    remaining: Number(response.headers.get("x-ratelimit-remaining") || 0),
    used: Number(response.headers.get("x-ratelimit-used") || 0),
    reset: Number(response.headers.get("x-ratelimit-reset") || 0),
    resource: response.headers.get("x-ratelimit-resource") || "core",
    retryAfter: Number(response.headers.get("retry-after") || 0)
  };
}

async function apiRequest(path, state, { optional = false, force = false, publicOnly = false, accept = "application/vnd.github+json", degradeOnRateLimit = false } = {}) {
  const settings = state.settings;
  const ttl = Number(settings.cacheMinutes || 5) * 60 * 1000 || CACHE_TTL;
  const scope = publicOnly || !settings.token ? "public" : "authenticated";
  if (!force) {
    const cached = await readCache(path, ttl, scope);
    if (cached) {
      state.sources.push({ path, status: 200, cached: true, scope, fetchedAt: new Date(cached.at).toISOString() });
      return cached.value;
    }
  }

  const headers = {
    Accept: accept,
    "X-GitHub-Api-Version": API_VERSION
  };
  if (settings.token && !publicOnly) headers.Authorization = `Bearer ${settings.token}`;

  let response;
  try {
    response = await fetch(`${API}${path}`, { headers });
  } catch (error) {
    state.sources.push({ path, status: 0, cached: false, scope, error: "Network request failed" });
    if (optional) return null;
    throw new Error(`GitHub API request failed: ${error.message}`);
  }

  state.rate = rateFrom(response);
  state.sources.push({
    path,
    status: response.status,
    cached: false,
    scope,
    fetchedAt: new Date().toISOString()
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.message || "";
    } catch {}
    const rateFailure = githubRateLimitFailure(response.status, detail, state.rate);
    if (rateFailure) {
      if (optional && degradeOnRateLimit) return null;
      const error = new Error(rateFailure.message);
      error.code = rateFailure.code;
      error.resetAt = rateFailure.resetAt;
      throw error;
    }
    if (optional && OPTIONAL_STATUS_CODES.has(response.status)) return null;
    throw new Error(`${response.status} ${detail || response.statusText}`.trim());
  }

  let value;
  try {
    value = await response.json();
  } catch {
    if (optional) return null;
    throw new Error("Invalid GitHub API response.");
  }
  await writeCache(path, value, scope);
  return value;
}

async function externalJson(urlValue, state, { optional = true, force = false, label = null } = {}) {
  const url = new URL(urlValue);
  if (!EXTERNAL_ORIGINS.has(url.origin)) throw new Error(`External OSINT origin is not allowlisted: ${url.origin}`);
  const ttl = Number(state.settings.cacheMinutes || 5) * 60 * 1000 || CACHE_TTL;
  const key = url.href;
  if (!force) {
    const cached = await readCache(key, ttl, "public-external");
    if (cached) {
      state.sources.push({ path: label || url.href, status: 200, cached: true, scope: "public-external", fetchedAt: new Date(cached.at).toISOString() });
      return cached.value;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response;
  try {
    response = await fetch(url.href, { headers: { Accept: "application/json" }, signal: controller.signal });
  } catch {
    state.sources.push({ path: label || url.href, status: 0, cached: false, scope: "public-external", error: "Network request failed" });
    if (optional) return null;
    throw new Error(`Public-source request failed for ${url.hostname}`);
  } finally {
    clearTimeout(timeout);
  }
  state.sources.push({ path: label || url.href, status: response.status, cached: false, scope: "public-external", fetchedAt: new Date().toISOString() });
  if (!response.ok) {
    if (optional) return null;
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  let value;
  try {
    value = await response.json();
  } catch {
    if (optional) return null;
    throw new Error(`Invalid public-source response from ${url.hostname}`);
  }
  await writeCache(key, value, "public-external");
  return value;
}

function stateFor(settings) {
  return { settings, sources: [], rate: null };
}

async function fingerprintSshKeys(keys) {
  return Promise.all((keys || []).map(async (item) => {
    const [type, encoded] = String(item.key || "").split(/\s+/);
    let fingerprint = null;
    try {
      const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const base64 = btoa(String.fromCharCode(...digest)).replace(/=+$/, "");
      fingerprint = `SHA256:${base64}`;
    } catch {}
    return { id: item.id, type: type || "SSH", key: item.key, fingerprint };
  }));
}

async function investigateProfile(login, force, pageData = {}) {
  const settings = await getSettings();
  const state = stateFor(settings);
  const userPath = `/users/${encodeURIComponent(login)}`;
  const user = await apiRequest(userPath, state, { force });
  const optional = { optional: true, force, degradeOnRateLimit: true };
  const [repos, events, orgs, keys, gpgKeys, socialAccounts, gists, followers, following, starred, subscriptions, receivedEvents] = await Promise.all([
    apiRequest(`${userPath}/repos?per_page=100&sort=pushed&type=public`, state, optional),
    apiRequest(`${userPath}/events/public?per_page=100`, state, optional),
    apiRequest(`${userPath}/orgs?per_page=100`, state, optional),
    apiRequest(`${userPath}/keys?per_page=100`, state, optional),
    apiRequest(`${userPath}/gpg_keys?per_page=100`, state, optional),
    apiRequest(`${userPath}/social_accounts?per_page=100`, state, optional),
    apiRequest(`${userPath}/gists?per_page=100`, state, optional),
    apiRequest(`${userPath}/followers?per_page=100`, state, optional),
    apiRequest(`${userPath}/following?per_page=100`, state, optional),
    apiRequest(`${userPath}/starred?per_page=100&sort=updated`, state, optional),
    apiRequest(`${userPath}/subscriptions?per_page=100`, state, optional),
    apiRequest(`${userPath}/received_events/public?per_page=100`, state, optional)
  ]);
  const keyDetails = await fingerprintSshKeys(keys || []);
  const collected = {
    user, repos: repos || [], events: events || [], orgs: orgs || [], keys: keyDetails, gpgKeys: gpgKeys || [],
    socialAccounts: socialAccounts || [], achievements: pageData.achievements || [], pageData,
    gists: gists || [], followers: followers || [], following: following || [], starred: starred || [],
    subscriptions: subscriptions || [], receivedEvents: receivedEvents || []
  };
  const analysis = analyzeProfile(collected);
  return { analysis, raw: collected, sources: state.sources, rate: state.rate, authenticated: Boolean(settings.token) };
}

async function fetchCommits(owner, repo, state, force) {
  const target = Math.max(25, Math.min(500, Number(state.settings.commitDepth || 100)));
  const pages = Math.ceil(target / 100);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`;
  const commits = [];
  for (let page = 1; page <= pages; page += 1) {
    const batch = await apiRequest(`${base}?per_page=100&page=${page}`, state, { optional: true, force });
    if (!batch?.length) break;
    commits.push(...batch);
    if (batch.length < 100) break;
  }
  return commits.slice(0, target);
}

async function investigateRestrictedRepository(owner, name, state, force, pageData = {}) {
  const encodedOwner = encodeURIComponent(owner);
  const targetUrl = `https://github.com/${owner}/${name}`;
  const targetSlug = `${owner}/${name}`;
  const searchAccept = "application/vnd.github.text-match+json, application/vnd.github+json";
  const publicOptional = { optional: true, force, publicOnly: true, degradeOnRateLimit: true };
  const [ownerRecord, ownerRepos, ownerEvents, ownerGists, issueSearch, commitSearch, repositorySearch, repositoryReferenceSearch, grepSearch, archiveSearch] = await Promise.all([
    apiRequest(`/users/${encodedOwner}`, state, publicOptional),
    apiRequest(`/users/${encodedOwner}/repos?per_page=100&sort=pushed&type=public`, state, publicOptional),
    apiRequest(`/users/${encodedOwner}/events/public?per_page=100`, state, publicOptional),
    apiRequest(`/users/${encodedOwner}/gists?per_page=100`, state, publicOptional),
    apiRequest(`/search/issues?q=${encodeURIComponent(`"${targetSlug}" in:title,body,comments`)}&per_page=25`, state, { ...publicOptional, accept: searchAccept }),
    apiRequest(`/search/commits?q=${encodeURIComponent(`"${targetUrl}"`)}&per_page=25`, state, { ...publicOptional, accept: searchAccept }),
    apiRequest(`/search/repositories?q=${encodeURIComponent(`${name} in:name`)}&per_page=25`, state, publicOptional),
    apiRequest(`/search/repositories?q=${encodeURIComponent(`"${targetSlug}" in:readme,description`)}&per_page=25`, state, publicOptional),
    state.settings.externalOsint ? externalJson(`https://grep.app/api/search?q=${encodeURIComponent(targetUrl)}`, state, { force, label: `grep.app public code: ${targetSlug}` }) : Promise.resolve(null),
    state.settings.externalOsint ? externalJson(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(`github.com/${targetSlug}*`)}&output=json&fl=timestamp,original,statuscode,mimetype,digest&filter=statuscode:200&collapse=digest&limit=50`, state, { force, label: `Internet Archive captures: ${targetSlug}` }) : Promise.resolve(null)
  ]);
  const collected = {
    target: { owner, name },
    owner: ownerRecord,
    ownerRepos: ownerRepos || [],
    ownerEvents: ownerEvents || [],
    ownerGists: ownerGists || [],
    issueSearch,
    commitSearch,
    repositorySearch,
    repositoryReferenceSearch,
    grepSearch,
    archiveSearch,
    externalSourcesEnabled: Boolean(state.settings.externalOsint),
    pageData
  };
  return {
    analysis: analyzeRestrictedRepository(collected),
    raw: collected,
    sources: state.sources,
    rate: state.rate,
    authenticated: false,
    collectionBoundary: "All fallback requests were sent without authentication."
  };
}

async function investigateRepository(owner, name, force, pageData = {}) {
  const settings = await getSettings();
  const state = stateFor(settings);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const repo = await apiRequest(base, state, { optional: true, force, publicOnly: true });
  if (!repo || repo.private || repo.visibility === "private") return investigateRestrictedRepository(owner, name, state, force, pageData);
  const [commits, languages, contributors, branches, tags, releases, community, workflows] = await Promise.all([
    fetchCommits(owner, name, state, force),
    apiRequest(`${base}/languages`, state, { optional: true, force }),
    apiRequest(`${base}/contributors?per_page=100&anon=1`, state, { optional: true, force }),
    apiRequest(`${base}/branches?per_page=100`, state, { optional: true, force }),
    apiRequest(`${base}/tags?per_page=100`, state, { optional: true, force }),
    apiRequest(`${base}/releases?per_page=100`, state, { optional: true, force }),
    apiRequest(`${base}/community/profile`, state, { optional: true, force }),
    apiRequest(`${base}/actions/workflows?per_page=100`, state, { optional: true, force })
  ]);
  const analysis = analyzeRepository({
    repo,
    commits: commits || [],
    languages: languages || {},
    contributors: contributors || [],
    branches: branches || [],
    tags: tags || [],
    releases: releases || [],
    community,
    workflows
  });
  return { analysis, raw: { repo, commits: commits || [], languages: languages || {}, contributors: contributors || [], branches: branches || [], tags: tags || [], releases: releases || [], community, workflows }, sources: state.sources, rate: state.rate, authenticated: Boolean(settings.token) };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "INVESTIGATE") {
    (async () => {
      try {
        const context = message.context;
        if (context?.kind === "repository") {
          sendResponse({ ok: true, data: toSerializable(await investigateRepository(context.owner, context.repo, Boolean(message.force), context.pageData)) });
        } else if (context?.kind === "profile") {
          sendResponse({ ok: true, data: toSerializable(await investigateProfile(context.login, Boolean(message.force), context.pageData)) });
        } else {
          sendResponse({ ok: false, error: "This is not a supported GitHub profile or repository page." });
        }
      } catch (error) {
        sendResponse({
          ok: false,
          error: error?.message || "Investigation failed.",
          errorCode: error?.code || null,
          resetAt: error?.resetAt || null
        });
      }
    })();
    return true;
  }

  if (message?.type === "GET_SETTINGS") {
    getSettings().then((settings) => sendResponse({ ok: true, settings: { ...settings, token: settings.token ? "configured" : "" } }));
    return true;
  }
  return false;
});
