# GitHub PR Review Toolkit

One Tampermonkey userscript that adds a floating panel and a few per-file helpers to GitHub pull requests. It needs no token: it reads GitHub through your already signed-in browser session.

## Install

1. Install Tampermonkey.
2. Create a new script and paste in `gh-pr-review-toolkit.user.js`.
3. Open a PR. Tampermonkey will ask to allow connections to `github.com`, `raw.githubusercontent.com` and `patch-diff.githubusercontent.com`; allow them.

## First-time setup

Set `myOwners` to the CODEOWNERS teams you belong to, or files owned by your teams will be marked as owned by others. Your own GitHub login is picked up automatically, so only teams need listing. Open the Tampermonkey menu, choose **Edit config (JSON)**, and edit the array, for example `"myOwners": ["my-org/my-team"]`. Use the same `org/team` form that appears in CODEOWNERS. The panel can't look up your memberships itself because that needs a GitHub API token.

If the Linear and ADO ticket chips don't link as expected, see `ticketRules` and `adoBase` in the same config.

## How data is loaded

Two requests per PR, made by Tampermonkey with your GitHub session cookies:

- `/<owner>/<repo>/pull/<n>.diff` for the file list, per-file additions and deletions, and blob SHAs (from the diff's `index` lines).
- `/<owner>/<repo>/raw/HEAD/.github/CODEOWNERS` (falling back to `CODEOWNERS` and `docs/CODEOWNERS`) for ownership.

If either fails (signed out, SSO expired, very large PR where GitHub refuses to render the diff), the panel says so and the features that depend on it switch off. Everything that only reads the page keeps working.

## Features

| Feature | Notes |
|---|---|
| Always-visible tab nav | Conversation / Commits / Checks / Files in the panel, Alt+1..4. By default **Checks ↓** scrolls to the merge box's checks summary on the Conversation tab (going there first if you're on another tab); turn on "Checks nav item opens the Checks tab" in settings to open the tab instead. The title bar also has a ↑ Top button that stays put when the panel is collapsed. Handles both `/files` and `/changes`. Plain clicks navigate in-page by clicking a real link so GitHub's own router handles it; if the URL hasn't changed after 1.5s the script falls back to a full page load. |
| Ticket chips | Own row under the nav. IDs come from the PR title and branch name. `AB#123` is treated as ADO; it links once the script has seen any `…/_workitems/edit/…` link on a page (remembered afterwards) or you set `adoBase`. Any other `ABC-123` is Linear. Branch names match case-insensitively; `ticketIgnorePrefixes` filters look-alikes such as `UTF-8` and `fix-12`. Rules live in `ticketRules`. |
| Collapse test and generated files | Finds each file's path from its header (verified against the container's `diff-<sha256>` id) and clicks GitHub's own chevron, so the chevron expands it again. Files you expand stay expanded across refreshes. If no chevron is found, the script hides the body itself and adds a toggle button. Patterns: `generatedPatterns`; tests are `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `*_test.py`, `test_*.py`. |
| Dim test files in the tree | Dims test files and folders in the left file tree. Paths are rebuilt from the tree's nested labels, so compacted folders work. |
| Mark files owned by others | CODEOWNERS, last matching rule wins. "Mine" is your login or any `myOwners` team. In the left file tree, files owned by others get an amber dot before the name (hover for the reason). Panel buttons: mark / hide (turn the feature off in settings; hide removes those files from the tree). `minePatterns` (regexes) can mark extra paths as yours. |
| Viewed-state across pushes | Records the file's blob SHA when you tick Viewed (the checkbox, or the newer diff's Viewed button). After a push, files whose SHA differs get a badge, a blue dot in the left file tree (hover for the reason), and are listed in the panel. |
| "Changed since viewed" filter | Adds a **Changed since viewed (N)** checkbox to GitHub's own file tree filter menu, under "Viewed files". It only appears while N > 0. When ticked, the diff and the file tree show only those files (folders with none are hidden), combined with GitHub's own filters. It turns itself off once you've re-viewed them all. The choice is remembered per PR. |
| Next / previous unviewed file | Alt+N jumps to the next file whose Viewed box is unticked, Alt+Shift+N to the previous one. Files collapsed as generated or test, and files hidden by a filter, are skipped. Wraps around. Files GitHub hasn't rendered yet are not visible to it. |
| Copy quote with link | Select code in a diff and press Alt+C. Copies a Markdown link to the file and selected lines (`…/files#diff-<id>R10-R12`, `L` for removed lines) followed by the code in a fenced block. If line numbers can't be read it still copies the code with a link to the file. |
| Keyboard shortcut help | Click **?** in the panel bar or press Alt+/ to list every shortcut that is currently enabled. Esc, ✕ or a click outside closes it. |
| Change stats | Additions and deletions by category (source, tests, docs, config, generated). |
| Unresolved thread navigator | Panel buttons, or Alt+J / Alt+K. |
| Hide bot comments | Conversation tab timeline items authored by bots. |
| Snippet expander | Type `;nit` then space in any comment box. Defaults: `;nit`, `;q`, `;block`, `;lgtm`, `;test`, `;why`. Edit via **Edit config (JSON)**. |
| Whitespace hidden by default | Off by default. Redirects to `?w=1` once per tab per PR, and never when the URL already has a `w` parameter. |

Every feature has a toggle in the settings modal, opened with the ⚙ in the panel bar or Alt+, (grouped, with a Reset to defaults button). **Edit config (JSON)** and **Reset config** are in the Tampermonkey menu; only settings you change are stored.

## Removed because they need an API token

Failing checks, the AI Generated banner, and the diff since your last review. The data isn't available from the signed-in pages without the GitHub API. Possible to bring back with a read-only token or a local helper that proxies `gh auth token`.

## Maintenance notes

GitHub's DOM changes. Per-file features anchor on each file container's `id="diff-<sha256 of path>"`, the `data-file-path` button in the header, and the header's chevron button (see `fileEntries`, `fileContainer`, `findChevron`). The file tree is matched through `role="tree"` / `role="treeitem"`. If a per-file feature stops working, those are the first places to look.

The filter row is injected into the React `ActionMenu` that the tree's filter button opens (`[data-component="ActionMenu.Overlay"]`), cloned from its `li[role="menuitemcheckbox"]` whose label is "Viewed files". If GitHub renames that label or restructures the menu, `injectFilterItem` stops adding the row.

Viewed state is read from each file's Viewed control (`VIEWED_CONTROL_SEL`): the classic checkbox, or the newer diff's `button[aria-pressed][aria-label*="viewed"]`. Viewed-state across pushes and Alt+N both depend on it. Alt+C reads line numbers from `[data-line-number]` cells inside the selection's `<tr>` rows (`rowLine`, `selectedRows`), which is verified against the classic diff markup; the newer diff view may fall back to a link without line numbers.

Not built: whitespace-only change detection, ticket hover cards, per-file private notes.
