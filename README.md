# GitHub OSINT

GitHub OSINT is a local browser extension for GitHub OSINT research. It turns GitHub profile and repository pages into an evidence workspace that highlights public identity signals, repository posture, commit metadata, source provenance, and restricted-target public traces without using a remote backend.

The extension is built for researchers, defenders, investigators, and technical teams that need fast, conservative context from public GitHub data. It does not scrape private repository contents, read cookies, inspect browsing history, run secret scans, query breach datasets, or send telemetry.

## Features

- Profile intelligence for public account metadata, organizations, public repositories, contribution aggregates, public keys, gists, followers, following, starred repositories, watched repositories, and recent public activity.
- Repository intelligence for visibility, dates, size, license, topics, languages, contributors, branches, tags, releases, community files, workflows, repository settings, and maintenance signals.
- Commit identity review that deduplicates public Git author and committer emails, labels GitHub noreply addresses, records occurrence counts, preserves role/date evidence, and links back to source commits.
- Restricted target handling for private, deleted, renamed, or otherwise unavailable repository URLs using public-source fallback collection.
- Optional external public-index checks against grep.app and the Internet Archive for restricted targets.
- Source logging for every investigation, including endpoint, HTTP status, cache state, scope, and collection time.
- JSON evidence export with the analyzed result, raw public records, methodology statement, rate-limit state, and source log.
- Local settings for API token, commit depth, evidence cache duration, auto-open behavior, and external-index collection.

## Privacy

GitHub OSINT runs in the browser. It has no analytics, advertising, remote code, or third-party application server.

An optional GitHub token is stored in `chrome.storage.local` and sent only to `api.github.com` for eligible public GitHub API requests. Restricted-target fallback requests are intentionally unauthenticated so token-authorized private data cannot enter OSINT results. The token is never returned to page scripts and is never included in exported evidence.

Successful responses are cached temporarily in browser extension session storage when available and in service-worker memory for the current worker lifetime.