# GitHub OSINT Permissions

This document explains every browser extension permission and host permission required by GitHub OSINT.

## Manifest Permissions

| Permission | Why GitHub OSINT needs it |
|---|---|
| `storage` | Saves user settings such as optional GitHub token, commit scan depth, cache duration, auto-open preference, and external-index preference. It also supports short-lived extension session caching when the browser provides `chrome.storage.session`. |
| `activeTab` | Lets the toolbar popup send a toggle message to the active GitHub tab after the user clicks Open investigator. This avoids broad tab permissions. |

## Host Permissions

| Host | Why GitHub OSINT needs it |
|---|---|
| `https://api.github.com/*` | Fetches documented public GitHub REST API resources for the profile or repository the user is viewing, including metadata, repositories, commits, contributors, languages, branches, releases, keys, social accounts, and public search results. |
| `https://grep.app/*` | Supports the optional external public-index setting for restricted repository targets. When enabled, GitHub OSINT sends the exact public GitHub target URL to grep.app to look for public code-index references. |
| `https://web.archive.org/*` | Supports the optional external public-index setting for restricted repository targets. When enabled, GitHub OSINT asks the Internet Archive CDX API for public capture metadata for the target path. |

## Content Script Match

| Match | Why GitHub OSINT needs it |
|---|---|
| `https://github.com/*` | Detects supported GitHub profile and repository pages, reads visible page context such as profile contribution aggregates and restricted-page labels, and mounts the isolated investigator launcher. |

## Web Accessible Resources

GitHub OSINT exposes its panel HTML, CSS, JavaScript, and icon assets to `https://github.com/*` so the content script can load the extension-origin panel inside an iframe on GitHub pages.

## Permissions Not Requested

GitHub OSINT does not request browsing history, cookies, downloads, all-sites access, clipboard-read, webRequest, debugger, native messaging, geolocation, notifications, or background network access beyond the hosts listed above.

## Token Boundary

The optional GitHub token is stored locally in extension storage and is sent only to `api.github.com`. Restricted-target fallback requests are always unauthenticated so private repository data authorized by a token cannot enter those results.
