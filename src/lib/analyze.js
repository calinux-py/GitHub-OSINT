const DAY = 86_400_000;

export function daysSince(value, now = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY));
}

export function classifyEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  if (!value || !value.includes("@")) return "invalid";
  if (value.endsWith("@users.noreply.github.com") || value === "noreply@github.com") return "noreply";
  if (value.endsWith("@github.com")) return "github";
  return "public-commit";
}

function dedupe(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeLanguages(languages = {}) {
  const total = Object.values(languages).reduce((sum, n) => sum + Number(n || 0), 0);
  return Object.entries(languages)
    .map(([name, bytes]) => ({ name, bytes, percent: total ? (bytes / total) * 100 : 0 }))
    .sort((a, b) => b.bytes - a.bytes);
}

export function collectCommitEmails(commits = []) {
  const found = new Map();
  for (const item of commits || []) {
    const commitDate = item?.commit?.author?.date || item?.commit?.committer?.date || null;
    const verified = Boolean(item?.commit?.verification?.verified);
    for (const role of ["author", "committer"]) {
      const identity = item?.commit?.[role];
      const email = String(identity?.email || "").trim().toLowerCase();
      if (!email || !email.includes("@")) continue;
      const account = item?.[role]?.login || null;
      const existing = found.get(email) || {
        email,
        classification: classifyEmail(email),
        names: new Set(),
        roles: new Set(),
        accounts: new Set(),
        occurrences: 0,
        signedVerified: 0,
        firstSeen: null,
        lastSeen: null,
        sources: []
      };
      if (identity?.name) existing.names.add(identity.name);
      existing.roles.add(role);
      if (account) existing.accounts.add(account);
      existing.occurrences += 1;
      if (verified) existing.signedVerified += 1;
      if (commitDate && (!existing.firstSeen || commitDate < existing.firstSeen)) existing.firstSeen = commitDate;
      if (commitDate && (!existing.lastSeen || commitDate > existing.lastSeen)) existing.lastSeen = commitDate;
      if (item?.html_url && existing.sources.length < 4) {
        existing.sources.push({ url: item.html_url, sha: item.sha?.slice(0, 7), role, date: commitDate });
      }
      found.set(email, existing);
    }
  }
  return [...found.values()]
    .map((entry) => ({
      ...entry,
      names: [...entry.names],
      roles: [...entry.roles],
      accounts: [...entry.accounts],
      evidence: "Direct Git commit metadata"
    }))
    .sort((a, b) => {
      if (a.classification === "noreply" && b.classification !== "noreply") return 1;
      if (b.classification === "noreply" && a.classification !== "noreply") return -1;
      return b.occurrences - a.occurrences;
    });
}

function repoSignals(repo, commits, community, branches, contributors, now) {
  const signals = [];
  const staleDays = daysSince(repo?.pushed_at, now);
  if (repo?.archived) signals.push({ tone: "critical", label: "Archived", detail: "Repository is read-only." });
  if (repo?.disabled) signals.push({ tone: "critical", label: "Disabled", detail: "GitHub has disabled this repository." });
  if (staleDays != null && staleDays > 730) signals.push({ tone: "warn", label: "Long inactive", detail: `No repository push for ${staleDays} days.` });
  else if (staleDays != null && staleDays > 180) signals.push({ tone: "info", label: "Inactive", detail: `No repository push for ${staleDays} days.` });
  if (!repo?.license) signals.push({ tone: "warn", label: "No detected license", detail: "GitHub did not detect a repository license." });
  const files = community?.files || {};
  if (!files.security) signals.push({ tone: "info", label: "No security policy", detail: "No SECURITY.md was reported in the community profile." });
  if (!files.code_of_conduct) signals.push({ tone: "neutral", label: "No code of conduct", detail: "No code of conduct was reported." });
  if (repo?.fork) signals.push({ tone: "neutral", label: "Fork", detail: repo?.parent?.full_name ? `Forked from ${repo.parent.full_name}.` : "This repository is a fork." });
  const defaultBranch = (branches || []).find((branch) => branch.name === repo?.default_branch);
  if (defaultBranch && !defaultBranch.protected) signals.push({ tone: "info", label: "Default branch unprotected", detail: `${repo.default_branch} is not marked protected by the public branch response.` });
  if ((commits || []).length === 0) signals.push({ tone: "warn", label: "No commits returned", detail: "The default branch may be empty or inaccessible." });
  const known = (contributors || []).filter((c) => c.login && Number(c.contributions));
  const total = known.reduce((sum, c) => sum + c.contributions, 0);
  if (known.length && total && known[0].contributions / total >= 0.7) {
    signals.push({ tone: "info", label: "Concentrated contribution history", detail: `${known[0].login} accounts for ${Math.round((known[0].contributions / total) * 100)}% of returned contributor commits.` });
  }
  return signals;
}

export function analyzeRepository(raw, now = new Date()) {
  const { repo, commits = [], languages = {}, contributors = [], branches = [], tags = [], releases = [], community = null, workflows = null } = raw;
  const emails = collectCommitEmails(commits);
  const knownContributors = contributors.filter((item) => item.login).map((item) => ({
    login: item.login,
    contributions: item.contributions,
    avatar: item.avatar_url,
    url: item.html_url
  }));
  const anonymousContributors = contributors.filter((item) => !item.login).map((item) => ({
    name: item.name || "Anonymous contributor",
    email: item.email || null,
    contributions: item.contributions || 0
  }));
  return {
    kind: "repository",
    entity: {
      name: repo.full_name,
      title: repo.name,
      subtitle: repo.description || "No repository description",
      avatar: repo.owner?.avatar_url,
      url: repo.html_url,
      visibility: repo.visibility || (repo.private ? "private" : "public")
    },
    metrics: [
      { label: "Stars", value: repo.stargazers_count ?? 0 },
      { label: "Forks", value: repo.forks_count ?? 0 },
      { label: "Watching", value: repo.subscribers_count ?? 0 },
      { label: "Open issues", value: repo.open_issues_count ?? 0 }
    ],
    repo: {
      id: repo.id,
      nodeId: repo.node_id,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at,
      ageDays: daysSince(repo.created_at, now),
      staleDays: daysSince(repo.pushed_at, now),
      defaultBranch: repo.default_branch,
      sizeKb: repo.size,
      license: repo.license?.spdx_id || repo.license?.name || null,
      topics: repo.topics || [],
      archived: Boolean(repo.archived),
      fork: Boolean(repo.fork),
      parent: repo.parent?.full_name || null,
      networkCount: repo.network_count,
      cloneUrl: repo.clone_url,
      sshUrl: repo.ssh_url,
      homepage: repo.homepage || null,
      flags: {
        issues: repo.has_issues,
        discussions: repo.has_discussions,
        wiki: repo.has_wiki,
        pages: repo.has_pages,
        projects: repo.has_projects,
        signoffRequired: repo.web_commit_signoff_required
      }
    },
    emails,
    languages: normalizeLanguages(languages),
    contributors: knownContributors,
    anonymousContributors,
    branches: branches.map((item) => ({ name: item.name, protected: Boolean(item.protected), sha: item.commit?.sha })),
    tags: tags.map((item) => ({ name: item.name, sha: item.commit?.sha })),
    releases: releases.map((item) => ({ name: item.name || item.tag_name, tag: item.tag_name, date: item.published_at || item.created_at, url: item.html_url, prerelease: item.prerelease })),
    community: community ? {
      healthPercentage: community.health_percentage,
      description: community.description,
      files: Object.fromEntries(Object.entries(community.files || {}).map(([key, value]) => [key, value ? { url: value.html_url } : null]))
    } : null,
    workflows: workflows?.workflows?.map((item) => ({ name: item.name, state: item.state, path: item.path, url: item.html_url })) || [],
    signals: repoSignals(repo, commits, community, branches, contributors, now),
    scan: {
      commitsInspected: commits.length,
      oldestCommitInspected: commits.at(-1)?.commit?.author?.date || null,
      newestCommitInspected: commits[0]?.commit?.author?.date || null
    }
  };
}

function textFragments(item) {
  return dedupe((item?.text_matches || []).map((match) => String(match?.fragment || "").trim())).slice(0, 3);
}

function stripMarkup(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function archiveDate(timestamp) {
  const value = String(timestamp || "");
  if (!/^\d{14}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
}

export function analyzeRestrictedRepository(raw) {
  const {
    target,
    owner = null,
    ownerRepos = [],
    ownerEvents = [],
    ownerGists = [],
    issueSearch = null,
    commitSearch = null,
    repositorySearch = null,
    repositoryReferenceSearch = null,
    grepSearch = null,
    archiveSearch = null,
    externalSourcesEnabled = false,
    pageData = {}
  } = raw;
  const fullName = `${target.owner}/${target.name}`;
  const normalizedTarget = fullName.toLowerCase();
  const issueReferences = (issueSearch?.items || []).slice(0, 25).map((item) => ({
    title: item.title,
    url: item.html_url,
    repository: item.repository_url?.split("/repos/").at(-1) || null,
    state: item.state,
    type: item.pull_request ? "pull request" : "issue",
    updatedAt: item.updated_at,
    fragments: textFragments(item)
  }));
  const codeReferences = (grepSearch?.hits?.hits || []).slice(0, 25).map((item) => ({
    name: String(item.path || "").split("/").at(-1),
    path: item.path,
    url: `https://github.com/${item.repo}/blob/${encodeURIComponent(item.branch || "HEAD")}/${String(item.path || "").split("/").map(encodeURIComponent).join("/")}`,
    repository: item.repo || null,
    branch: item.branch || null,
    fragments: [stripMarkup(item.content?.snippet)].filter(Boolean),
    matches: Number(item.total_matches || 0)
  }));
  const commitReferences = (commitSearch?.items || []).filter((item) => item.repository?.private !== true).slice(0, 25).map((item) => ({
    sha: item.sha,
    url: item.html_url,
    repository: item.repository?.full_name,
    message: item.commit?.message,
    date: item.commit?.author?.date || item.commit?.committer?.date,
    author: item.commit?.author?.name,
    authorEmail: item.commit?.author?.email,
    account: item.author?.login || null
  }));
  const repositoryReferences = (repositoryReferenceSearch?.items || []).filter((item) => String(item.full_name || "").toLowerCase() !== normalizedTarget).slice(0, 25).map((item) => ({
    name: item.full_name,
    url: item.html_url,
    description: item.description,
    owner: item.owner?.login,
    fork: Boolean(item.fork),
    updatedAt: item.updated_at
  }));
  const archiveHeaders = Array.isArray(archiveSearch?.[0]) ? archiveSearch[0] : [];
  const archiveSnapshots = (Array.isArray(archiveSearch) ? archiveSearch.slice(1) : []).map((row) => Object.fromEntries(archiveHeaders.map((header, index) => [header, row[index]]))).filter((item) => item.timestamp && item.original).slice(0, 25).map((item) => ({
    date: archiveDate(item.timestamp),
    original: item.original,
    mimeType: item.mimetype,
    digest: item.digest,
    url: `https://web.archive.org/web/${item.timestamp}/${item.original}`
  }));
  const sameNameRepositories = (repositorySearch?.items || [])
    .filter((item) => String(item.name || "").toLowerCase() === String(target.name || "").toLowerCase())
    .filter((item) => String(item.full_name || "").toLowerCase() !== normalizedTarget)
    .slice(0, 25)
    .map((item) => ({
      name: item.full_name,
      url: item.html_url,
      description: item.description,
      owner: item.owner?.login,
      fork: Boolean(item.fork),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      pushedAt: item.pushed_at
    }));
  const publicTargetEvents = (ownerEvents || []).filter((event) => String(event.repo?.name || "").toLowerCase() === normalizedTarget).map((event) => ({
    type: event.type,
    date: event.created_at,
    url: `https://github.com/${fullName}`
  }));
  const publicOwnerRepos = (ownerRepos || []).slice(0, 12).map((repo) => ({
    name: repo.full_name,
    url: repo.html_url,
    language: repo.language,
    pushedAt: repo.pushed_at,
    stars: repo.stargazers_count,
    fork: Boolean(repo.fork)
  }));
  const publicOwnerGists = (ownerGists || []).slice(0, 12).map((gist) => ({
    id: gist.id,
    url: gist.html_url,
    description: gist.description,
    files: Object.keys(gist.files || {}),
    createdAt: gist.created_at,
    updatedAt: gist.updated_at
  }));
  const referenceCount = issueReferences.length + codeReferences.length + commitReferences.length + repositoryReferences.length + publicTargetEvents.length + archiveSnapshots.length;
  const signals = [{
    tone: "warn",
    label: "Not publicly resolvable",
    detail: "The repository endpoint returned no public repository record. This can mean private, renamed, deleted, or nonexistent. GitScope does not distinguish those states by bypassing access controls."
  }];
  if (referenceCount) signals.push({ tone: "info", label: "Public references found", detail: `${referenceCount} public search, archive, or activity records mention or capture the target.` });
  if (archiveSnapshots.length) signals.push({ tone: "info", label: "Archived public captures", detail: `${archiveSnapshots.length} distinct successful Internet Archive captures were returned. These may reflect a period when the target was publicly reachable.` });
  if (!externalSourcesEnabled) signals.push({ tone: "neutral", label: "External indexes disabled", detail: "Enable external public indexes in settings to query grep.app and Internet Archive for additional public traces." });
  if (sameNameRepositories.length) signals.push({ tone: "neutral", label: "Same-name repositories", detail: `${sameNameRepositories.length} public repositories share the target name. Name similarity alone does not establish a relationship.` });
  if (pageData?.privateLabelVisible) signals.push({ tone: "neutral", label: "Private label visible", detail: "The current GitHub page visibly labels this repository private; no private repository contents were collected." });

  return {
    kind: "restricted-repository",
    entity: {
      name: fullName,
      title: target.name,
      subtitle: "Private or otherwise unavailable repository target",
      avatar: owner?.avatar_url || null,
      url: `https://github.com/${fullName}`,
      visibility: "restricted / unavailable"
    },
    metrics: [
      { label: "Public references", value: referenceCount },
      { label: "Archive captures", value: archiveSnapshots.length },
      { label: "Code mentions", value: codeReferences.length },
      { label: "Commit mentions", value: commitReferences.length }
    ],
    target: {
      owner: target.owner,
      name: target.name,
      publiclyResolvable: false,
      privateLabelVisible: Boolean(pageData?.privateLabelVisible),
      externalSourcesEnabled: Boolean(externalSourcesEnabled),
      boundary: "Public-source evidence only; private contents were not requested."
    },
    owner: owner ? {
      login: owner.login,
      name: owner.name,
      type: owner.type,
      url: owner.html_url,
      bio: owner.bio,
      company: owner.company,
      location: owner.location,
      blog: owner.blog,
      publicRepos: owner.public_repos,
      followers: owner.followers,
      createdAt: owner.created_at,
      visibility: owner.user_view_type || "public"
    } : null,
    publicTraces: {
      issueReferences,
      codeReferences,
      commitReferences,
      repositoryReferences,
      archiveSnapshots,
      sameNameRepositories,
      publicTargetEvents,
      ownerRepositories: publicOwnerRepos,
      ownerGists: publicOwnerGists,
      incomplete: Boolean(issueSearch?.incomplete_results || commitSearch?.incomplete_results || repositorySearch?.incomplete_results || repositoryReferenceSearch?.incomplete_results)
    },
    signals
  };
}

function activitySummary(events = []) {
  const byType = {};
  const repos = {};
  for (const event of events) {
    byType[event.type] = (byType[event.type] || 0) + 1;
    if (event.repo?.name) repos[event.repo.name] = (repos[event.repo.name] || 0) + 1;
  }
  return {
    total: events.length,
    byType: Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count })),
    repositories: Object.entries(repos).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
    latest: events[0]?.created_at || null,
    oldest: events.at(-1)?.created_at || null
  };
}

function latestContribution(event) {
  if (!event) return null;
  const repo = event.repo?.name || null;
  const type = String(event.type || "Activity").replace(/Event$/, "");
  const actions = {
    PushEvent: event.payload?.size === 1 ? "Pushed 1 commit" : `Pushed ${event.payload?.size || event.payload?.commits?.length || "multiple"} commits`,
    PullRequestEvent: `${event.payload?.action || "Updated"} pull request #${event.payload?.number || event.payload?.pull_request?.number || ""}`.trim(),
    IssuesEvent: `${event.payload?.action || "Updated"} issue #${event.payload?.issue?.number || ""}`.trim(),
    IssueCommentEvent: `${event.payload?.action || "Added"} an issue comment`,
    CreateEvent: `Created ${event.payload?.ref_type || "repository content"}${event.payload?.ref ? ` ${event.payload.ref}` : ""}`,
    ForkEvent: "Forked a repository",
    WatchEvent: "Starred a repository",
    ReleaseEvent: `${event.payload?.action || "Published"} a release`
  };
  return {
    type,
    action: actions[event.type] || type,
    repository: repo,
    date: event.created_at || null,
    url: event.payload?.pull_request?.html_url || event.payload?.issue?.html_url || event.payload?.release?.html_url || (repo ? `https://github.com/${repo}` : null)
  };
}

export function analyzeProfile(raw, now = new Date()) {
  const {
    user, repos = [], events = [], orgs = [], keys = [], gpgKeys = [], socialAccounts = [], achievements = [], pageData = {},
    gists = [], followers = [], following = [], starred = [], subscriptions = [], receivedEvents = []
  } = raw;
  const languageCounts = {};
  for (const repo of repos) {
    if (repo.language) languageCounts[repo.language] = (languageCounts[repo.language] || 0) + 1;
  }
  const pushedRepos = [...repos].sort((a, b) => String(b.pushed_at).localeCompare(String(a.pushed_at)));
  const signals = [];
  const accountAge = daysSince(user.created_at, now);
  const profileStale = daysSince(user.updated_at, now);
  if (accountAge != null && accountAge < 30) signals.push({ tone: "info", label: "New account", detail: `Created ${accountAge} days ago.` });
  if (profileStale != null && profileStale > 730) signals.push({ tone: "neutral", label: "Profile unchanged", detail: `Public profile record has not changed for ${profileStale} days.` });
  if (!user.email) signals.push({ tone: "neutral", label: "No public profile email", detail: "Commit metadata may still contain addresses; GitHub profile API returned none." });
  if (!keys.length && !gpgKeys.length) signals.push({ tone: "neutral", label: "No public keys returned", detail: "No public SSH or GPG keys were returned by the public endpoints." });
  if (events.length === 0) signals.push({ tone: "neutral", label: "No recent public events", detail: "GitHub's public events endpoint returned no activity." });
  const privateProfile = String(user.user_view_type || "").toLowerCase() === "private" || Boolean(pageData.privateProfile);
  if (privateProfile) signals.push({ tone: "info", label: "Private profile", detail: "GitHub limits this profile's visible fields and activity. Public-repository activity and API records may still remain visible." });
  const publicEdges = gists.length + followers.length + following.length + starred.length + subscriptions.length + receivedEvents.length;
  if (privateProfile && publicEdges) signals.push({ tone: "info", label: "Public account edges", detail: `${publicEdges} public gists, social-graph records, repository interests, or received events were returned despite the profile privacy setting.` });
  if (pageData.contributions?.total != null) signals.push({ tone: "neutral", label: "Visible contribution aggregate", detail: `${pageData.contributions.total} contributions are displayed in the current public profile view; private contribution details remain anonymized.` });
  return {
    kind: "profile",
    entity: {
      name: user.login,
      title: user.name || user.login,
      subtitle: user.bio || `${user.type} account`,
      avatar: user.avatar_url,
      url: user.html_url,
      visibility: privateProfile ? "private" : (user.user_view_type || "public")
    },
    metrics: [
      { label: "Repositories", value: user.public_repos ?? 0 },
      { label: "Followers", value: user.followers ?? 0 },
      { label: "Following", value: user.following ?? 0 },
      { label: "Gists", value: user.public_gists ?? 0 }
    ],
    profile: {
      id: user.id,
      nodeId: user.node_id,
      type: user.type,
      siteAdmin: Boolean(user.site_admin),
      company: user.company,
      location: user.location,
      hireable: user.hireable,
      email: user.email,
      blog: user.blog,
      twitter: user.twitter_username,
      description: user.bio,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      ageDays: accountAge
    },
    organizations: orgs.map((item) => ({ login: item.login, avatar: item.avatar_url, url: `https://github.com/${item.login}` })),
    socialLinks: dedupe([
      ...socialAccounts.map((item) => item.url),
      user.twitter_username ? `https://x.com/${user.twitter_username}` : null,
      user.blog ? (/^https?:\/\//i.test(user.blog) ? user.blog : `https://${user.blog}`) : null
    ]),
    achievements: achievements.map((item) => ({ name: item.name, url: item.url, image: item.image })).filter((item) => item.name),
    publicSurface: {
      privateProfile,
      contributions: pageData.contributions || null
    },
    gists: gists.slice(0, 20).map((gist) => ({
      id: gist.id,
      url: gist.html_url,
      description: gist.description,
      files: Object.keys(gist.files || {}),
      public: gist.public !== false,
      createdAt: gist.created_at,
      updatedAt: gist.updated_at
    })),
    socialGraph: {
      followers: followers.slice(0, 50).map((item) => ({ login: item.login, url: item.html_url, avatar: item.avatar_url })),
      following: following.slice(0, 50).map((item) => ({ login: item.login, url: item.html_url, avatar: item.avatar_url }))
    },
    starredRepositories: starred.slice(0, 25).map((repo) => ({ name: repo.full_name, url: repo.html_url, description: repo.description, language: repo.language, stars: repo.stargazers_count })),
    watchedRepositories: subscriptions.slice(0, 25).map((repo) => ({ name: repo.full_name, url: repo.html_url, description: repo.description, language: repo.language, stars: repo.stargazers_count })),
    keys,
    gpgKeys,
    languages: Object.entries(languageCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    repositories: pushedRepos.slice(0, 12).map((repo) => ({
      name: repo.full_name,
      description: repo.description,
      language: repo.language,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      pushedAt: repo.pushed_at,
      archived: repo.archived,
      fork: repo.fork,
      url: repo.html_url
    })),
    repoStats: {
      fetched: repos.length,
      forks: repos.filter((repo) => repo.fork).length,
      archived: repos.filter((repo) => repo.archived).length,
      sources: repos.filter((repo) => !repo.fork).length
    },
    activity: { ...activitySummary(events), latestContribution: latestContribution(events[0]) },
    receivedActivity: activitySummary(receivedEvents),
    signals
  };
}

export function toSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}
