# GitHub OSINT privacy

GitHub OSINT is a local browser extension. It sends requests to `api.github.com` for the GitHub profile or repository the user is viewing and for bounded public-reference searches about a restricted repository target. If the user enables **Query external public indexes**, it also sends the target owner/repository string to `grep.app` and `web.archive.org`. It has no analytics, telemetry, advertising, remote code, or third-party backend.

## Data handled

- Public profile and organization metadata.
- Public repository metadata, languages, contributors, branches, tags, releases, workflows, and community-profile files.
- Public commit metadata, including Git author and committer names and email addresses embedded in returned commit objects.
- Public SSH and GPG key records.
- Public issue, pull-request, commit-message, repository-metadata, indexed-code, and archive-capture references to a restricted repository URL.
- Public owner metadata, same-name repository leads, and contribution-calendar aggregates visibly published on a profile page.
- Public gists, followers, following, starred repositories, watched repositories, and received public events.
- A user-supplied GitHub API token, if configured.

Responses are cached temporarily in `chrome.storage.session` when available and in service-worker memory. Export happens only when the user selects **Export evidence**.

External index queries are disabled by default. Enabling them discloses the target's owner/repository string to grep.app and the Internet Archive. GitHub OSINT reads only public code-index results and capture metadata; it does not automatically retrieve archived repository contents.

## Token storage

An optional token is stored in `chrome.storage.local`. Browser extension storage is not a dedicated operating-system credential vault. Use a fine-grained, read-only token without private-repository access. The initial repository visibility check and every restricted-target fallback request are sent without authentication, so token-authorized private data cannot enter those results. GitHub OSINT never returns the token to page content and never includes it in exports.
