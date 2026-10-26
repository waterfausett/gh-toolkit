# README Screenshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hero GIF and per-group screenshots in the README, taken from a real public demo repo with the real script running.

**Architecture:** A public demo repo (`waterfausett/gh-toolkit-demo`, local clone `C:\git\gh-toolkit-demo`) holds a small TypeScript service, a CI workflow that uploads Cobertura coverage, and PRs staged to light up features. Capture happens in an Orca browser tab signed in as `waterfausett`; the userscript is injected per page with `orca eval` after a `GM_*` stand-in. Images land in `docs/images/` here and the README links them.

**Tech Stack:** TypeScript, Vitest + `@vitest/coverage-v8` (cobertura reporter), GitHub Actions, `gh` CLI, Orca CLI browser commands, ffmpeg (or a Node GIF encoder) for the hero.

**Spec:** `docs/superpowers/specs/2026-10-24-readme-screenshots-design.md`

## Global Constraints

- Clean and real: no lorem ipsum, `foo.js` or placeholder names; no dev tools, notifications or spinners in shots.
- One theme for every image.
- No changes to either userscript.
- Capture tooling stays in the session scratchpad, not in this repo.
- Hero GIF ~10–15 s, aim < 5 MB.
- Coverage CI: checkout `${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}`; artifact name `coverage`.

## Review Focus

- Script injected twice on soft (Turbo) navigation → duplicate panels. Inject once per full load and guard on an existing panel element.
- Shots taken before async sections (stats, coverage, badges) finish → half-loaded. Wait for the section's text before every screenshot.
- Coverage PR lands at 100% or <70% → wrong tone. Check the chip's number before capturing; adjust tests in the demo PR if needed.
- Stand-in storage keys colliding with GitHub's own `localStorage` → prefix every key with `gmshim:`.
- CI not finished when capturing → coverage panel shows "waiting". Confirm the run is complete with `gh run list` first.

---

### Task 1: Demo repo on master

**Files (in `C:\git\gh-toolkit-demo`):** `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `src/**`, `test/**`, `.github/workflows/ci.yml`, `.github/CODEOWNERS`, `README.md`.

- [ ] Scaffold a small, believable service (e.g. an order/invoice API helper library) with a few modules and tests.
- [ ] `vitest.config.ts`: coverage provider `v8`, reporters include `cobertura`, output `coverage/cobertura-coverage.xml`.
- [ ] `ci.yml`: on `push` to master and `pull_request`; checkout head SHA per Global Constraints; `npm ci`; `npx vitest run --coverage`; `actions/upload-artifact@v4` name `coverage`, path `coverage/cobertura-coverage.xml`.
- [ ] `CODEOWNERS`: some paths owned by `@waterfausett`, others by a different owner so "owned by others" dots appear.
- [ ] Run `npm test` locally. Expected: all pass, `coverage/cobertura-coverage.xml` exists.
- [ ] `gh repo create waterfausett/gh-toolkit-demo --public --source . --push`; `gh run watch`. Expected: CI green, artifact `coverage` listed.

### Task 2: Scenario PRs

- [ ] One branch + PR per row of the spec's PR table, with real-looking commits, titles and descriptions; ticket IDs like `PAY-142` in title and branch name.
- [ ] Coverage PR: new code with an untested error branch / fallback. Expected: CI green, artifact present.
- [ ] Verify with `gh pr list -R waterfausett/gh-toolkit-demo` and `gh run list`. Expected: all PRs open, all runs complete.

### Task 3: Capture harness (scratchpad)

**Files:** `<scratchpad>/capture/gm-shim.js`, `<scratchpad>/capture/inject.ps1`.

- [ ] `gm-shim.js` defines `GM_getValue/GM_setValue/GM_deleteValue/GM_listValues` over `localStorage` with `gmshim:` prefix (JSON values), `GM_addStyle`, `GM_setClipboard`, `GM_registerMenuCommand` (no-op), `GM_xmlhttpRequest` over `fetch` (`responseType: "arraybuffer"` supported) that first checks `window.__gmshimArtifacts[url]` (base64 zip) for artifact URLs.
- [ ] `inject.ps1 -Url <url> [-Artifacts <run>:<id>,...]`: `orca goto`, wait load, optionally fetch artifact zips with `gh api` and eval them into `__gmshimArtifacts`, eval shim + userscript body (guarded against double inject).
- [ ] Open a tab on a demo PR, inject. Expected: panel visible in `orca screenshot`, no errors in `orca console`.

### Task 4: Sign-in and review state

- [ ] Open `https://github.com/login` in an Orca tab; ask the owner to sign in; `orca wait --url github.com` then confirm `meta[name=user-login]` is `waterfausett`.
- [ ] Set state through the UI with the script injected: mark files viewed on the "viewed across pushes" PR, then push a new commit to it; start a pending review on another; star one, save one for later, visit a few (recent); add a saved search or two; set `myOwners` via stand-in storage.

### Task 5: Stills

- [ ] One theme, fixed viewport (e.g. 1440×900). For each group in the spec, navigate, inject, wait for the relevant text, `orca screenshot`, crop if needed, save to `docs/images/<group>.png`. Plus `coverage.png` and `workflow-filter.png`.
- [ ] Review each image by eye against the Global Constraints.

### Task 6: Hero GIF

- [ ] Use Orca capture if it records video; otherwise take a timed screenshot sequence along the path PR list → PR → Files → panel sections, and encode to `docs/images/hero.gif`. Expected: 10–15 s, < 5 MB.

### Task 7: README and PR

**Files:** Modify `README.md`.

- [ ] Hero GIF under the tagline; each group's image directly under its `### ` heading, before its `<details>`; alt text describing the shot.
- [ ] Commit images + README; push `readme-screenshots`; `gh pr create` with a summary listing the shots (and the coverage fallback if used).
