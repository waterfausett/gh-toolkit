# README screenshots and hero GIF — design

## Intent

The README is a long feature list, almost all of it folded inside `<details>` blocks. Someone landing on the repo can't tell at a glance what the toolkit does. The goal is to **show** it: a hero animation at the top and a screenshot for each feature group, all taken from real GitHub pages with the real script running.

The owner's two favourite stories, in order:

1. **The PR list page** — Starred / Saved for later / Recent / Pending chips, saved searches, review badges and ticket chips on each row. "It helps you find and track PRs."
2. **The review itself** — the floating panel, progress meter, viewed-across-pushes markers, debug leftovers, change stats, collapsed noise files. "It makes reviewing a lot less painful."

## Goals

- A hero GIF under the title, about 10–15 s, going from a repo's Pull requests page into a PR and through the panel.
- One still screenshot per feature group (Navigation, Review progress, Less noise, Writing reviews, Insights, Beyond the PR page), shown above that group's `<details>` list, plus one of the Actions workflow filter.
- Everything delivered on the `readme-screenshots` branch as a PR for review.

## Non-goals

- No change to either userscript's behaviour.
- No screenshot for every single `<details>` item; one per group, more only where a group has a clear standout.
- No reusable/committed capture tooling in this repo. Capture scripts live in the session scratchpad.

## Anti-goals

The owner's bar: **clean and real.** It fails if shots look staged or fake (lorem ipsum, `foo.js`, obvious placeholder names), cluttered (unrelated browser chrome, dev tools, notifications, half-loaded spinners), or broken (the script visibly erroring, empty panels, wrong theme mid-set).

## Decided

- **Account:** the owner's own `waterfausett` account; their name and avatar may appear in shots.
- **Demo repo:** a new public repo under that account (working name `waterfausett/gh-toolkit-demo`). Creating it is outward-facing, so confirm with the owner before running `gh repo create`.
- **Browser:** Orca's built-in browser, in a tab on this worktree. The owner is away from home and signs in to GitHub in that tab once when asked; Playwright is not used (its session would be separate).
- **Running the script:** inject `gh-pr-review-toolkit.user.js` (and `gh-actions-workflow-filter.user.js` for its shot) into each page with `orca eval`, preceded by small stand-ins for the `GM_*` grants: `GM_getValue/SetValue/DeleteValue/ListValues` over `localStorage` with a prefix, `GM_addStyle`, `GM_setClipboard` (no-op or `navigator.clipboard`), `GM_registerMenuCommand` (no-op), `GM_xmlhttpRequest` over `fetch`. Re-inject after full page loads.
- **Assets:** `docs/images/` in this repo. PNG for stills, GIF for the hero.

## The demo repo

A small but believable app: say a TypeScript/Node service with `src/`, `test/`, a `package.json` + `package-lock.json`, and a `CODEOWNERS` naming a couple of teams or users so the "owned by others" dots show. Real-sounding names and code throughout.

PRs (about 5–8), each built to light up specific features:

| PR idea | Lights up |
|---|---|
| Feature PR with source + tests + lockfile change, `ABC-123`-style ticket in title and branch | progress meter, change stats, collapsed generated/test files, dependency changes, ticket chips |
| PR containing a `console.log`, a `debugger` and a `TODO` | debug leftovers |
| PR with a whitespace-only file and a rename-only file | whitespace/rename collapsing |
| PR where files were marked viewed, then a new commit pushed | viewed-across-pushes, "changed since viewed", new commits since last look, list badge |
| PR with an unresolved review thread and a bot-style comment | thread navigator, hide bot comments |
| PR left with a pending (unsubmitted) review | pending chip/badge on list |
| One or two plain PRs for list volume, one starred, one saved for later | list chips, saved searches |

Several PRs being authored by `waterfausett` is fine ("My PRs"); review-state scenarios that need "someone else's PR" may be approximated, since there is one account.

## Calls made in writing this up (owner to check)

- The demo repo stays up after the PR merges so shots can be retaken when features change; it is not deleted.
- Shots go above each group's list, not inside the collapsed `<details>`, so they're seen without clicking.
- One theme for every image (builder's choice of light or dark).

## What's left to the builder

- Exact demo app domain, file contents, PR titles and how many PRs.
- Which config the injected script runs with (e.g. `myOwners`, a saved search or two) — set via the stand-in storage.
- Viewport size and light vs dark theme — pick one theme for the whole set; consistent cropping.
- How the GIF is made: Orca screen capture if it supports video, otherwise a sequence of screenshots stitched into a GIF (ffmpeg or a Node library in the scratchpad). Keep it small enough for a README (aim < 5 MB).
- New-line coverage: include only if the demo repo's CI artifact can be fetched through the `GM_xmlhttpRequest` stand-in (cross-origin to `blob.core.windows.net` may be blocked); otherwise leave it out without comment.
- README layout details: image widths, alt text, whether the hero sits above or below the install badges.
