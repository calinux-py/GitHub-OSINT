const $ = (selector) => document.querySelector(selector);
const state = { context: null, result: null, activeTab: "overview", loading: false };
const VIEWS = ["empty", "loading", "error", "results"];
const VIEW_STATUS = {
  empty: "Ready for public API requests",
  loading: "Collecting public API data…",
  error: "Collection interrupted"
};
let loadingTimer = null;

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? esc(url.href) : "#";
  } catch {
    return "#";
  }
}

function urlLabel(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "") || value;
  } catch {
    return value;
  }
}

function normalizeUrl(value) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Intl.NumberFormat(undefined, { notation: number >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(number);
}

function formatDate(value, includeTime = false) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function duration(days) {
  if (days == null) return "Unknown";
  if (days < 2) return `${days} day`;
  if (days < 60) return `${days} days`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

function bytesFromKb(kb) {
  const bytes = Number(kb || 0) * 1024;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function showOnly(id) {
  for (const section of VIEWS) {
    $(`#${section}`).classList.toggle("hidden", section !== id);
  }
  $("#export").disabled = id !== "results";
  if (VIEW_STATUS[id]) $("#rate-status").textContent = VIEW_STATUS[id];
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => el.classList.remove("show"), 1800);
}

function section(title, meta, body, className = "") {
  return `<section class="section-card ${className}"><div class="section-head"><h2>${esc(title)}</h2>${meta ? `<span>${esc(meta)}</span>` : ""}</div>${body}</section>`;
}

function kv(rows) {
  return `<div class="section-body kv">${rows.filter(([, value]) => value !== undefined).map(([key, value]) => `<div class="key">${esc(key)}</div><div class="value">${value == null || value === "" ? "—" : value}</div>`).join("")}</div>`;
}

function noData(message) {
  return `<div class="section-body"><p class="note">${esc(message)}</p></div>`;
}

function renderIdentityHeader(analysis) {
  const entity = analysis.entity;
  const typeLabel = analysis.kind === "restricted-repository" ? "restricted" : analysis.kind;
  $("#identity").innerHTML = `
    ${entity.avatar ? `<img class="avatar" src="${safeUrl(entity.avatar)}" alt="">` : `<span class="avatar avatar-fallback" aria-hidden="true">?</span>`}
    <div class="identity-copy"><h1><a href="${safeUrl(entity.url)}" target="_blank" rel="noreferrer">${esc(entity.name)}</a></h1><p title="${esc(entity.subtitle)}">${esc(entity.subtitle)}</p></div>
    <span class="entity-type">${esc(typeLabel)}</span>`;
  $("#metrics").innerHTML = analysis.metrics.map((item) => `<div class="metric"><strong>${formatNumber(item.value)}</strong><span>${esc(item.label)}</span></div>`).join("");
}

function signalsCard(signals) {
  const body = signals?.length
    ? `<ul class="signals">${signals.map((item) => `<li class="signal ${esc(item.tone)}"><span class="signal-dot"></span><div><strong>${esc(item.label)}</strong><p>${esc(item.detail)}</p></div></li>`).join("")}</ul>`
    : noData("No notable signals were derived from the returned public records.");
  return section("Analyst signals", `${signals?.length || 0} observations`, body);
}

function restrictedReferenceList(items, renderItem, emptyMessage) {
  return items?.length
    ? `<ul class="item-list">${items.map((item) => `<li class="list-item">${renderItem(item)}</li>`).join("")}</ul>`
    : noData(emptyMessage);
}

function renderRestrictedOverview(a) {
  const owner = a.owner;
  return [
    section("Target boundary", "Public-source fallback", kv([
      ["Target", esc(a.entity.name)],
      ["Public repository record", "Not returned"],
      ["Private label on page", a.target.privateLabelVisible ? "Visible" : "Not observed"],
      ["External public indexes", a.target.externalSourcesEnabled ? "Enabled" : "Disabled in settings"],
      ["Collection boundary", esc(a.target.boundary)]
    ])),
    signalsCard(a.signals),
    section("Public trace coverage", a.publicTraces.incomplete ? "Partial results" : "Completed searches", kv([
      ["Issue / pull-request references", esc(a.publicTraces.issueReferences.length)],
      ["Public code references", esc(a.publicTraces.codeReferences.length)],
      ["Public commit-message references", esc(a.publicTraces.commitReferences.length)],
      ["Archived public captures", esc(a.publicTraces.archiveSnapshots.length)],
      ["Repository README / description refs", esc(a.publicTraces.repositoryReferences.length)],
      ["Same-name public repositories", esc(a.publicTraces.sameNameRepositories.length)],
      ["Public target events", esc(a.publicTraces.publicTargetEvents.length)],
      ["Owner public gists", esc(a.publicTraces.ownerGists.length)]
    ])),
    owner ? section("Public owner record", "GitHub user API", kv([
      ["Account", `<a href="${safeUrl(owner.url)}" target="_blank" rel="noreferrer">@${esc(owner.login)}</a>`],
      ["Type", esc(owner.type)], ["Profile visibility", esc(owner.visibility)],
      ["Public repositories", esc(owner.publicRepos)], ["Followers", esc(owner.followers)],
      ["Created", esc(formatDate(owner.createdAt))]
    ])) : section("Public owner record", "Not returned", noData("GitHub did not return a public user or organization record for the owner segment."))
  ].join("");
}

function renderRepoOverview(a) {
  const r = a.repo;
  const scan = a.scan;
  return [
    section("Repository record", "API object", kv([
      ["Repository ID", esc(r.id)], ["Node ID", esc(r.nodeId)], ["Created", esc(formatDate(r.createdAt))],
      ["Last push", `${esc(formatDate(r.pushedAt))} · ${esc(duration(r.staleDays))} ago`], ["Default branch", esc(r.defaultBranch)],
      ["Repository size", esc(bytesFromKb(r.sizeKb))], ["License", esc(r.license || "Not detected")],
      ["Network", `${formatNumber(r.networkCount)} repositories`]
    ])),
    signalsCard(a.signals),
    section("Evidence coverage", `${scan.commitsInspected} commits`, kv([
      ["Commits inspected", esc(scan.commitsInspected)], ["Newest sampled", esc(formatDate(scan.newestCommitInspected))],
      ["Oldest sampled", esc(formatDate(scan.oldestCommitInspected))], ["Unique emails", esc(a.emails.length)]
    ])),
    a.repo.topics?.length ? section("Topics", `${a.repo.topics.length} tags`, `<div class="section-body pill-row">${a.repo.topics.map((topic) => `<span class="pill">${esc(topic)}</span>`).join("")}</div>`) : ""
  ].join("");
}

function renderProfileOverview(a) {
  const p = a.profile;
  const contribution = a.activity.latestContribution;
  return [
    section("Account record", "API object", kv([
      ["User ID", esc(p.id)], ["Node ID", esc(p.nodeId)], ["Account type", esc(p.type)],
      ["Created", `${esc(formatDate(p.createdAt))} · ${esc(duration(p.ageDays))} old`], ["Record updated", esc(formatDate(p.updatedAt))],
      ["Profile visibility", esc(a.entity.visibility)], ["Site administrator", p.siteAdmin ? "Yes" : "No"],
      ["Hireable", p.hireable == null ? "Unspecified" : p.hireable ? "Yes" : "No"]
    ])),
    a.publicSurface?.contributions ? section("Visible contribution aggregate", a.publicSurface.privateProfile ? "Private profile surface" : "Profile page", kv([
      ["Contributions shown", a.publicSurface.contributions.total == null ? "Not parsed" : formatNumber(a.publicSurface.contributions.total)],
      ["Active calendar days", esc(a.publicSurface.contributions.activeDays)],
      ["Calendar range", `${esc(formatDate(a.publicSurface.contributions.firstDate))} - ${esc(formatDate(a.publicSurface.contributions.lastDate))}`],
      ["Private marker visible", a.publicSurface.contributions.privateMarkerVisible ? "Yes" : "No"]
    ])) : "",
    contribution ? section("Last contribution", esc(formatDate(contribution.date, true)), `<div class="section-body"><div class="contribution"><strong>${esc(contribution.action)}</strong><p>${contribution.repository ? `<a href="${safeUrl(contribution.url)}" target="_blank" rel="noreferrer">${esc(contribution.repository)}</a>` : "Repository unavailable"}</p></div></div>`) : section("Last contribution", "Not returned", noData("No recent public contribution was returned by GitHub.")),
    signalsCard(a.signals),
    section("Public repository set", `${a.repoStats.fetched} fetched`, kv([
      ["Original repositories", esc(a.repoStats.sources)], ["Forks", esc(a.repoStats.forks)], ["Archived", esc(a.repoStats.archived)],
      ["Recent public events", esc(a.activity.total)]
    ])),
    a.organizations.length ? section("Public organizations", `${a.organizations.length} returned`, `<div class="section-body pill-row">${a.organizations.map((org) => `<a class="pill" href="${safeUrl(org.url)}" target="_blank" rel="noreferrer">${esc(org.login)}</a>`).join("")}</div>`) : ""
  ].join("");
}

function emailCard(a) {
  if (!a.emails.length) return section("Commit-associated emails", "0 found", noData(`No email addresses were present in the ${a.scan.commitsInspected} commits inspected. This is not evidence that none exist elsewhere in history.`));
  const items = a.emails.map((item) => {
    const sourceLinks = item.sources.map((source) => `<a href="${safeUrl(source.url)}" target="_blank" rel="noreferrer">${esc(source.sha || "commit")}</a>`).join("");
    const label = item.classification === "noreply" ? "GitHub privacy address" : item.classification === "github" ? "GitHub-hosted address" : "Public commit address";
    return `<div class="email-item"><div><div class="email-value">${esc(item.email)}</div><div class="email-meta">${esc(label)} · ${item.occurrences} occurrence${item.occurrences === 1 ? "" : "s"}${item.accounts.length ? ` · @${esc(item.accounts.join(", @"))}` : ""}<br>Roles: ${esc(item.roles.join(", "))}${item.lastSeen ? ` · latest ${esc(formatDate(item.lastSeen))}` : ""}${sourceLinks ? `<br>Evidence: ${sourceLinks}` : ""}</div></div><button class="copy-button" type="button" data-copy="${esc(item.email)}">COPY</button></div>`;
  }).join("");
  return section("Commit-associated emails", `${a.emails.length} unique`, items);
}

function profileIdentity(a) {
  const p = a.profile;
  const contactRows = [
    ["Description", esc(p.description || "Not published")],
    ["Public email", p.email ? `<span>${esc(p.email)}</span> <button class="tiny-button" data-copy="${esc(p.email)}">COPY</button>` : "Not published"],
    ["Company", esc(p.company || "Not published")], ["Location", esc(p.location || "Not published")],
    ["Website", p.blog ? `<a href="${safeUrl(normalizeUrl(p.blog))}" target="_blank" rel="noreferrer">${esc(p.blog)}</a>` : "Not published"],
    ["Twitter / X", p.twitter ? `@${esc(p.twitter)}` : "Not published"]
  ];
  const socials = a.socialLinks?.length ? `<div class="section-body pill-row">${a.socialLinks.map((url) => `<a class="pill" href="${safeUrl(url)}" target="_blank" rel="noreferrer">${esc(urlLabel(url))}</a>`).join("")}</div>` : noData("No public social links were returned.");
  const achievements = a.achievements?.length ? `<div class="section-body achievement-grid">${a.achievements.map((item) => `<a class="achievement" href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">${item.image ? `<img src="${safeUrl(item.image)}" alt="">` : ""}<span>${esc(item.name)}</span></a>`).join("")}</div>` : noData("No public achievements were visible on this profile page.");
  const ssh = a.keys.length ? `<ul class="item-list">${a.keys.map((key) => `<li class="list-item"><strong>${esc(key.type)} key · ID ${esc(key.id)}</strong><p>${esc(key.fingerprint || "Fingerprint unavailable")}</p></li>`).join("")}</ul>` : noData("No public SSH keys were returned.");
  const gpg = a.gpgKeys.length ? `<ul class="item-list">${a.gpgKeys.map((key) => `<li class="list-item"><strong>GPG ${esc(key.key_id || key.id)}</strong><p>${esc((key.emails || []).map((item) => item.email).filter(Boolean).join(", ") || key.name || "Public signing key")}</p></li>`).join("")}</ul>` : noData("No public GPG keys were returned.");
  return [section("Published identity", "Profile API", kv(contactRows)), section("Social links", `${a.socialLinks?.length || 0} returned`, socials), section("Achievements", `${a.achievements?.length || 0} visible`, achievements), section("Public SSH keys", `${a.keys.length} returned`, ssh), section("Public GPG keys", `${a.gpgKeys.length} returned`, gpg)].join("");
}

function repoIdentity(a) {
  const anonymous = a.anonymousContributors.filter((item) => item.email);
  return [
    emailCard(a),
    anonymous.length ? section("Anonymous contributor records", `${anonymous.length} returned`, `<ul class="item-list">${anonymous.map((item) => `<li class="list-item"><strong>${esc(item.name)}</strong><p>${esc(item.email)} · ${esc(item.contributions)} contributions</p></li>`).join("")}</ul>`) : "",
    section("Interpretation", "Read before use", `<div class="section-body"><p class="note"><strong>Direct evidence only.</strong> Addresses shown here occur in public Git commit objects returned by GitHub. A Git author field is self-asserted and may be stale, shared, spoofed, or a privacy-preserving <code>noreply</code> address. A verified commit signature verifies the commit signature; it does not independently prove ownership of every displayed address.</p></div>`)
  ].join("");
}

function restrictedIdentity(a) {
  const owner = a.owner;
  return [
    section("OSINT collection boundary", "No private contents", `<div class="section-body"><p class="note"><strong>Restricted target.</strong> GitScope did not request commits, branches, files, collaborators, workflows, or other private repository resources. The target status is intentionally reported as private or unavailable because a public 404 cannot prove which condition applies.</p></div>`),
    owner ? section("Published owner identity", "Public profile record", kv([
      ["Display name", esc(owner.name || "Not published")], ["Bio", esc(owner.bio || "Not published")],
      ["Company", esc(owner.company || "Not published")], ["Location", esc(owner.location || "Not published")],
      ["Website", owner.blog ? `<a href="${safeUrl(normalizeUrl(owner.blog))}" target="_blank" rel="noreferrer">${esc(owner.blog)}</a>` : "Not published"]
    ])) : ""
  ].join("");
}

function languagesCard(items, countMode = false) {
  if (!items?.length) return section("Language profile", "No data", noData("No language data was returned."));
  const max = countMode ? Math.max(...items.map((item) => item.count)) : 100;
  const body = `<div class="section-body bar-list">${items.slice(0, 10).map((item) => {
    const value = countMode ? item.count : item.percent;
    const width = countMode ? (value / max) * 100 : value;
    return `<div class="bar-item"><span>${esc(item.name)}</span><span class="bar"><i style="width:${Math.max(2, Math.min(100, width))}%"></i></span><em>${countMode ? esc(item.count) : `${value.toFixed(1)}%`}</em></div>`;
  }).join("")}</div>`;
  return section("Language profile", `${items.length} languages`, body);
}

function repoTechnical(a) {
  const r = a.repo;
  const flags = Object.entries(r.flags).map(([key, value]) => `<span class="pill">${esc(key)}: ${value ? "yes" : "no"}</span>`).join("");
  const protectedCount = a.branches.filter((branch) => branch.protected).length;
  const community = a.community
    ? section("Community profile", `${a.community.healthPercentage ?? 0}% health`, `<div class="section-body pill-row">${Object.entries(a.community.files || {}).map(([name, file]) => file ? `<a class="pill" href="${safeUrl(file.url)}" target="_blank" rel="noreferrer">${esc(name)}</a>` : `<span class="pill">${esc(name)}: absent</span>`).join("")}</div>`)
    : section("Community profile", "Unavailable", noData("GitHub did not return a community profile for this repository."));
  const contributors = a.contributors.length
    ? `<div class="section-body">${a.contributors.slice(0, 10).map((item) => `<div class="activity-row"><a href="${safeUrl(item.url)}" target="_blank" rel="noreferrer"><strong>@${esc(item.login)}</strong></a><span>${formatNumber(item.contributions)} commits</span></div>`).join("")}</div>`
    : noData("No contributor list was returned.");
  return [
    languagesCard(a.languages),
    section("Repository posture", "Public settings", kv([
      ["Default branch", esc(r.defaultBranch)], ["Branches returned", `${a.branches.length} · ${protectedCount} protected`],
      ["Tags returned", esc(a.tags.length)], ["Releases returned", esc(a.releases.length)],
      ["Web sign-off", r.flags.signoffRequired ? "Required" : "Not required"], ["Clone URL", `<span>${esc(r.cloneUrl)}</span>`]
    ])),
    section("Feature flags", "Repository config", `<div class="section-body pill-row">${flags}</div>`),
    community,
    section("Top contributors", `${a.contributors.length} returned`, contributors),
    a.workflows.length ? section("Actions workflows", `${a.workflows.length} returned`, `<ul class="item-list">${a.workflows.map((flow) => `<li class="list-item"><strong><a href="${safeUrl(flow.url)}" target="_blank" rel="noreferrer">${esc(flow.name)}</a></strong><p>${esc(flow.state)} · ${esc(flow.path)}</p></li>`).join("")}</ul>`) : ""
  ].join("");
}

function restrictedTechnical(a) {
  const traces = a.publicTraces;
  const issues = restrictedReferenceList(traces.issueReferences, (item) => `<strong><a href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">${esc(item.title || "Untitled reference")}</a></strong><p>${esc(item.repository || "Public repository")} &middot; ${esc(item.type)} &middot; updated ${esc(formatDate(item.updatedAt))}</p>${item.fragments?.length ? `<p>${esc(item.fragments.join(" ... "))}</p>` : ""}`, "No public issue or pull-request references were returned.");
  const code = restrictedReferenceList(traces.codeReferences, (item) => `<strong><a href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">${esc(item.repository || "Public repository")}/${esc(item.path || item.name)}</a></strong><p>${esc(item.branch || "default branch")} &middot; ${formatNumber(item.matches)} matches in file</p>${item.fragments?.length ? `<p>${esc(item.fragments.join(" ... "))}</p>` : ""}`, "No references were returned from the public grep.app code index.");
  const commits = restrictedReferenceList(traces.commitReferences, (item) => `<strong><a href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">${esc(item.repository || item.sha?.slice(0, 7) || "Public commit")}</a></strong><p>${esc(item.message || "No message")} &middot; ${esc(formatDate(item.date))}</p><p>${esc(item.author || "Unknown author")}${item.account ? ` (@${esc(item.account)})` : ""}${item.authorEmail ? ` &middot; ${esc(item.authorEmail)}` : ""}</p>`, "No public commit messages referencing the target URL were returned.");
  const archives = restrictedReferenceList(traces.archiveSnapshots, (item) => `<strong><a href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">Capture from ${esc(formatDate(item.date))}</a></strong><p>${esc(item.original)} &middot; ${esc(item.mimeType || "unknown type")}</p>`, "No successful Internet Archive captures were returned.");
  const repoRefs = restrictedReferenceList(traces.repositoryReferences, (item) => `<strong><a href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">${esc(item.name)}</a></strong><p>${esc(item.description || "Target matched in repository README or description")} &middot; updated ${esc(formatDate(item.updatedAt))}</p>`, "No public repository README or description references were returned.");
  const sameName = restrictedReferenceList(traces.sameNameRepositories, (item) => `<strong><a href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">${esc(item.name)}</a></strong><p>${esc(item.description || "No description")} &middot; ${item.fork ? "fork" : "repository"}</p>`, "No other public repositories with the same name were returned.");
  const ownerRepos = restrictedReferenceList(traces.ownerRepositories, (item) => `<strong><a href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">${esc(item.name)}</a></strong><p>${esc(item.language || "No language")} &middot; pushed ${esc(formatDate(item.pushedAt))}</p>`, "No public repositories were returned for the owner.");
  const ownerGists = restrictedReferenceList(traces.ownerGists, (item) => `<strong><a href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">${esc(item.description || item.files.join(", ") || item.id)}</a></strong><p>${esc(item.files.join(", ") || "No file names")} &middot; updated ${esc(formatDate(item.updatedAt))}</p>`, "No public gists were returned for the owner.");
  return [
    section("Archived public captures", `${traces.archiveSnapshots.length} returned`, archives),
    section("Public commit-message references", `${traces.commitReferences.length} returned`, commits),
    section("Public issue and PR references", `${traces.issueReferences.length} returned`, issues),
    section("Public code-index references", `${traces.codeReferences.length} returned`, code),
    section("Repository metadata references", `${traces.repositoryReferences.length} returned`, repoRefs),
    section("Same-name public repositories", `${traces.sameNameRepositories.length} returned`, sameName),
    section("Owner public repositories", `${traces.ownerRepositories.length} shown`, ownerRepos),
    section("Owner public gists", `${traces.ownerGists.length} shown`, ownerGists),
    section("Interpretation", "Association limits", `<div class="section-body"><p class="note">A public mention or same-name repository is a lead, not proof that it is controlled by, forked from, or otherwise associated with the unavailable target. Validate each source independently.</p></div>`)
  ].join("");
}

function profileTechnical(a) {
  const repos = a.repositories.length
    ? `<div class="section-body">${a.repositories.map((repo) => `<div class="repo-row"><div><a href="${safeUrl(repo.url)}" target="_blank" rel="noreferrer"><strong>${esc(repo.name)}</strong></a><p>${esc(repo.language || "No language")} · pushed ${esc(formatDate(repo.pushedAt))}${repo.archived ? " · archived" : ""}${repo.fork ? " · fork" : ""}</p></div><span>★ ${formatNumber(repo.stars)}</span></div>`).join("")}</div>`
    : noData("No public repositories were returned.");
  const events = a.activity.byType.length
    ? `<div class="section-body">${a.activity.byType.slice(0, 10).map((item) => `<div class="activity-row"><strong>${esc(item.type.replace(/Event$/, ""))}</strong><span>${item.count}</span></div>`).join("")}</div>`
    : noData("No recent public events were returned.");
  const gists = restrictedReferenceList(a.gists, (item) => `<strong><a href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">${esc(item.description || item.files.join(", ") || item.id)}</a></strong><p>${esc(item.files.join(", ") || "No file names")} &middot; updated ${esc(formatDate(item.updatedAt))}</p>`, "No public gists were returned.");
  const stars = restrictedReferenceList(a.starredRepositories, (item) => `<strong><a href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">${esc(item.name)}</a></strong><p>${esc(item.language || "No language")} &middot; ${formatNumber(item.stars)} stars</p>`, "No public starred repositories were returned.");
  const watched = restrictedReferenceList(a.watchedRepositories, (item) => `<strong><a href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">${esc(item.name)}</a></strong><p>${esc(item.language || "No language")} &middot; ${formatNumber(item.stars)} stars</p>`, "No public watched repositories were returned.");
  const followers = a.socialGraph.followers.length ? `<div class="section-body pill-row">${a.socialGraph.followers.map((item) => `<a class="pill" href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">@${esc(item.login)}</a>`).join("")}</div>` : noData("No follower records were returned.");
  const following = a.socialGraph.following.length ? `<div class="section-body pill-row">${a.socialGraph.following.map((item) => `<a class="pill" href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">@${esc(item.login)}</a>`).join("")}</div>` : noData("No following records were returned.");
  return [
    languagesCard(a.languages, true),
    section("Recently pushed repositories", `${a.repositories.length} shown`, repos),
    section("Public event mix", `${a.activity.total} events`, events),
    section("Public gists", `${a.gists.length} shown`, gists),
    section("Recently starred repositories", `${a.starredRepositories.length} shown`, stars),
    section("Watched repositories", `${a.watchedRepositories.length} shown`, watched),
    section("Public followers", `${a.socialGraph.followers.length} shown`, followers),
    section("Public following", `${a.socialGraph.following.length} shown`, following)
  ].join("");
}

function sourcesTab(result) {
  const sources = result.sources || [];
  const body = `<ul class="source-list">${sources.map((source) => `<li class="source-item"><div class="source-path"><span class="status-dot ${source.status && source.status < 400 ? "" : "fail"}"></span>${esc(source.path)}</div><div class="source-meta">${esc(source.cached ? "CACHE" : `HTTP ${source.status}`)} · ${esc((source.scope || "public").toUpperCase())}<br>${esc(source.fetchedAt ? formatDate(source.fetchedAt, true) : "not fetched")}</div></li>`).join("")}</ul>`;
  return [
    section("API evidence log", `${sources.length} requests`, body),
    section("Evidence semantics", "Confidence", `<div class="section-body"><p class="note">Profile fields are GitHub account records. Repository configuration is a current snapshot. Public-search references are leads, not proof of association. Commit names and emails are embedded Git identities and remain self-asserted unless supported by other evidence. “Not returned” means unavailable in this collection—not proof of absence.</p></div>`)
  ].join("");
}

function renderTab() {
  if (!state.result) return;
  const a = state.result.analysis;
  let html = "";
  if (state.activeTab === "overview") html = a.kind === "restricted-repository" ? renderRestrictedOverview(a) : a.kind === "repository" ? renderRepoOverview(a) : renderProfileOverview(a);
  if (state.activeTab === "identity") html = a.kind === "restricted-repository" ? restrictedIdentity(a) : a.kind === "repository" ? repoIdentity(a) : profileIdentity(a);
  if (state.activeTab === "technical") html = a.kind === "restricted-repository" ? restrictedTechnical(a) : a.kind === "repository" ? repoTechnical(a) : profileTechnical(a);
  if (state.activeTab === "sources") html = sourcesTab(state.result);
  $("#tab-content").innerHTML = html;
  document.querySelectorAll(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === state.activeTab));
}

function renderResult(result) {
  state.result = result;
  renderIdentityHeader(result.analysis);
  renderTab();
  const rate = result.rate;
  $("#rate-status").textContent = rate?.limit
    ? `${result.authenticated ? "AUTH" : "PUBLIC"} · ${rate.remaining}/${rate.limit} ${rate.resource} requests left`
    : `${result.authenticated ? "AUTHENTICATED" : "PUBLIC"} API`;
  showOnly("results");
}

function animateLoading(start) {
  window.clearInterval(loadingTimer);
  if (!start) return;
  let index = 0;
  const steps = [...document.querySelectorAll(".loading-steps li")];
  loadingTimer = window.setInterval(() => {
    steps.forEach((step, i) => step.classList.toggle("active", i === index));
    index = (index + 1) % steps.length;
  }, 650);
}

async function investigate(force = false) {
  if (!state.context || state.loading) return;
  state.loading = true;
  state.result = null;
  state.activeTab = "overview";
  const target = state.context.kind === "repository" ? `${state.context.owner}/${state.context.repo}` : `@${state.context.login}`;
  $("#loading-target").textContent = target;
  showOnly("loading");
  animateLoading(true);
  try {
    const response = await chrome.runtime.sendMessage({ type: "INVESTIGATE", context: state.context, force });
    if (!response?.ok) {
      const failure = new Error(response?.error || "No response from the extension worker.");
      failure.code = response?.errorCode;
      failure.resetAt = response?.resetAt;
      throw failure;
    }
    renderResult(response.data);
  } catch (error) {
    $("#error-message").textContent = error?.message || "The collection request failed.";
    const help = $("#error-help");
    if (error?.code === "GITHUB_RATE_LIMIT") {
      help.innerHTML = `
        <strong>Rate limit enforced by GitHub</strong>
        <p>GitHub limits unauthenticated API traffic from your public IP. This quota is not created or controlled by GitHub OSINT. Adding a fine-grained token lets GitHub apply the larger authenticated allowance.</p>
        <div class="help-links">
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a token on GitHub ↗</a>
          <a href="https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api" target="_blank" rel="noreferrer">Read GitHub's rate-limit rules ↗</a>
        </div>
        <button class="secondary-button" id="rate-settings" type="button">Enter token in GitHub OSINT</button>`;
      help.classList.remove("hidden");
    } else {
      help.replaceChildren();
      help.classList.add("hidden");
    }
    showOnly("error");
  } finally {
    state.loading = false;
    animateLoading(false);
  }
}

function exportEvidence() {
  if (!state.result) return;
  const evidence = {
    schema: "gitscope-evidence/v1",
    exportedAt: new Date().toISOString(),
    target: state.context,
    methodology: "Public GitHub page and REST API records. Restricted-repository fallback searches are unauthenticated; optional external results come from grep.app's public code index and Internet Archive capture metadata. No private contents are collected. Commit identities are self-asserted Git metadata.",
    ...state.result
  };
  const blob = new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const name = state.result.analysis.entity.name.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
  link.href = url;
  link.download = `gitscope-${name}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Evidence bundle exported");
}

document.querySelector(".tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tab]");
  if (!button) return;
  state.activeTab = button.dataset.tab;
  renderTab();
  $("#main").scrollTo({ top: 0, behavior: "smooth" });
});

$("#tab-content").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.dataset.copy);
    toast("Copied to clipboard");
  } catch {
    toast("Clipboard access was blocked");
  }
});

$("#close").addEventListener("click", () => window.parent.postMessage({ source: "gitscope-panel", type: "CLOSE" }, "*"));
$("#refresh").addEventListener("click", () => investigate(true));
$("#retry").addEventListener("click", () => investigate(true));
$("#error-help").addEventListener("click", (event) => {
  if (event.target.closest("#rate-settings")) chrome.runtime.openOptionsPage();
});
$("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#export").addEventListener("click", exportEvidence);

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.data?.source !== "gitscope-content" || event.data.type !== "CONTEXT") return;
  const context = event.data.context;
  if (!context) return;
  const same = JSON.stringify(context) === JSON.stringify(state.context);
  state.context = context;
  if (!same) investigate(false);
});

window.parent.postMessage({ source: "gitscope-panel", type: "READY" }, "*");
