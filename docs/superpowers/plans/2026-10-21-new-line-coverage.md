# New-line Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show coverage of the PR's added lines, read from Cobertura XML in GitHub Actions artifacts, inside the PR Review Toolkit userscript.

**Architecture:** Pure parsing/matching functions live in one delimited `coverage-core` region of `gh-pr-review-toolkit.user.js` that touches no DOM, `GM_*` or toolkit state, so a Node test can extract and run it. A loader uses the toolkit's session-cookie requests to find CI jobs for the head commit (`/commit/<sha>/status-details` JSON), list artifacts (run page HTML), download and unzip them, and cache only numbers and salted hashes. The UI reuses the debug-leftovers patterns: file badges, inline counter, Alt+key stepping and a panel section.

**Tech Stack:** Tampermonkey userscript (plain JS, one file), `GM_xmlhttpRequest`, `DecompressionStream`; tests use Node 26's built-in `node:test` (no package.json, no dependencies).

**Spec:** `docs/superpowers/specs/2026-10-21-new-line-coverage-design.md`

## Global Constraints

- No API token: all requests go through `GM_xmlhttpRequest` with the session cookie, like `fetchText` (`gh-pr-review-toolkit.user.js:305`).
- Persist only numbers, salted `digest()` hashes, commit SHAs and run ids. Never paths, code, repo names or report text. Downloaded zips and XML stay in memory.
- Never draw coverage from a commit other than the current head on the diff.
- Header gains `// @connect blob.core.windows.net` (not `*`).
- Config defaults: `coverageArtifactPattern: "cov"` (case-insensitive regex), `coverageThreshold: 80`, `coverageWarnMargin: 10`; feature key `coverage: true`.
- Tone: pct ≥ threshold → green; ≥ threshold − margin → amber; else red.
- Storage keys: `v3:coverage:<digest(pr.key)>` (one per PR, overwritten per head) and `v3:coverageRepo:<digest(owner/repo)>`. Coverage entries are pruned after 7 days, repo flags after 90 days.
- Downloads: at most 3 at a time; skip artifacts over 50 MB.
- Cobertura only. No Istanbul and no lcov.
- Code style: match the file. Arrow-function consts, `h()` for DOM, sparse comments that explain *why*.

## Research done while planning (changes from the spec's assumptions)

- **Finding jobs for the head:** `GET /<owner>/<repo>/commit/<sha>/status-details` with the JSON headers `loadCommitOids` uses returns `{ checkRuns: [{ state, pending, targetUrl, name, … }], checksHeaderState, checksStatusSummary }`. Actions jobs have `targetUrl` `/<o>/<r>/actions/runs/<runId>/job/<jobId>`. This replaces scraping the checks page. It's scoped to one SHA, so "is this run for the head?" is answered by construction. A re-run creates new job ids, which gives the cache stamp. Fixture: `tests/fixtures/coverage/status-details.json`.
- **Expired artifacts:** once deleted, artifacts vanish from the run page entirely, so expired looks the same as never uploaded. **Deviation:** the spec's "expired" and "no artifacts" states merge into one message: "No coverage artifacts for `<sha7>` (CI may not upload them, or they've expired)".
- **Head SHA:** `state.commitOids?.at(-1)`, else `(await loadCommitOids(pr))?.at(-1)`. This works with `sinceLastLook` off. If it's still null (a PR with more than 250 commits), coverage shows the error state "Couldn't find the PR's head commit".
- Fixtures were captured from public pytest-dev/pytest pages while logged out. `run-artifacts.html` has 3 artifact rows. `pkg-coverage.xml` / `artifact.zip` are synthetic pytest-cov-shaped files. The zip has a deflated coverage XML, a stored HTML file and a non-coverage `junit.xml`.

## Review Focus

1. **A PR whose diff includes a file the report has under a same-named path in another package** (monorepo `pkg/__init__.py`): it must be "no data", never borrow hits. Pinned by Task 1 `matchCoverage` ambiguity tests.
2. **A file whose added lines are only comments or blank lines but is in the report** (measured = 0): no badge, not in the attention list, and not counted as "no data". Pinned by Task 1 `fileCoverage` test and Task 4 behavior.
3. **Re-running a failed job on the same head:** a new job id changes the stamp, so the cache misses and the result is recomputed. Results with a failed job are never cached. Pinned by Task 2 `parseStatusDetails` (`jobIds`/`failed`) and Task 3 cache step.
4. **CI still running on the head while an older head's entry is cached:** show waiting or nothing, never the old marks. Pinned by Task 3 (`head` mismatch means the cache is ignored).
5. **Coverage percentages near 100%:** 199/200 must not display "100%". Pinned by Task 1 `formatPct` test.

---

### Task 1: Test harness and pure coverage core

**Files:**
- Modify: `gh-pr-review-toolkit.user.js` (new region right after `const stripWs = …`, ~line 316)
- Create: `tests/coverage-core.test.mjs`
- Fixtures (committed with this plan): `tests/fixtures/coverage/{pkg-coverage.xml,artifact.zip}`

**Interfaces:**
- Produces, inside `// #region coverage-core` … `// #endregion coverage-core`:
  - `unzipText(buffer: ArrayBuffer, want: (name: string) => boolean): Promise<Array<{ name: string, text: string }>>`
  - `isCobertura(text: string): boolean`: `<coverage` followed by whitespace or `>` within the first 2000 chars.
  - `parseCobertura(xml: string): { sources: string[], files: Array<{ filename: string, lines: Map<number, number> }> }`
  - `addReport(index: Map<string, Map<number, number>>, report): void`
  - `matchCoverage(path: string, index): Map<number, number> | null`
  - `fileCoverage(added: number[], lines: Map<number, number> | null): { measured: number, missed: number[] } | null`
  - `formatPct(covered: number, measured: number): string`
  - `coverageTone(pct: number, threshold: number, margin: number): "ok" | "warn" | "bad"`

- [ ] **Step 1: Write the failing tests** in `tests/coverage-core.test.mjs`.

The harness reads the userscript, slices the text between the two region markers, and evaluates it with `new Function(regionText + "\nreturn { unzipText, isCobertura, parseCobertura, addReport, matchCoverage, fileCoverage, formatPct, coverageTone };")()`. Task 2 appends `parseStatusDetails, parseArtifactRows` to that return list. Use `node:test` and `node:assert/strict`.

```js
test("unzipText inflates wanted entries and skips the rest", async () => {
  const b = readFileSync(fixture("artifact.zip"));
  const files = await unzipText(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), (n) => n.endsWith(".xml"));
  assert.deepEqual(files.map((f) => f.name), [".test-cov/pkg-coverage.xml", ".test-cov/junit.xml"]);
  assert.equal(files[0].text, readFileSync(fixture("pkg-coverage.xml"), "utf8"));
});
test("unzipText rejects a non-zip", async () => {
  await assert.rejects(unzipText(new TextEncoder().encode("<html>").buffer, () => true));
});
test("isCobertura", () => {
  assert.equal(isCobertura(readFileSync(fixture("pkg-coverage.xml"), "utf8")), true);
  assert.equal(isCobertura("<testsuites/>"), false);
});
test("parseCobertura reads sources and per-line hits", () => {
  const r = parseCobertura(readFileSync(fixture("pkg-coverage.xml"), "utf8"));
  assert.deepEqual(r.sources, ["/home/runner/work/repo/repo/capabilities/pkg/src"]);
  assert.equal(r.files[0].filename, "pkg/cli.py");
  assert.deepEqual([...r.files[0].lines], [[1, 1], [2, 1], [4, 0], [5, 3], [7, 0], [8, 1]]);
});
test("addReport joins sources and keeps max hits across reports", () => {
  const index = new Map();
  const xml = readFileSync(fixture("pkg-coverage.xml"), "utf8");
  addReport(index, parseCobertura(xml));
  addReport(index, parseCobertura(xml.replace('number="4" hits="0"', 'number="4" hits="2"')));
  const lines = index.get("/home/runner/work/repo/repo/capabilities/pkg/src/pkg/cli.py");
  assert.equal(lines.get(4), 2);
  assert.equal(lines.get(7), 0);
  assert.equal(index.has("pkg/cli.py"), false); // bare filename only when a report has no <source>
});
test("matchCoverage: suffix match picks the shortest strong key", () => {
  const index = new Map([
    ["/w/repo/repo/capabilities/pkg/src/pkg/cli.py", new Map([[1, 1]])],
    ["/w/repo/repo/other/capabilities/pkg/src/pkg/cli.py", new Map([[1, 0]])],
  ]);
  assert.equal(matchCoverage("capabilities/pkg/src/pkg/cli.py", index).get(1), 1);
  assert.equal(matchCoverage("capabilities/pkg/src/pkg/nope.py", index), null);
});
test("matchCoverage: bare-filename fallback only when exactly one matches", () => {
  const one = new Map([["pkg/cli.py", new Map([[1, 1]])]]);
  assert.equal(matchCoverage("a/src/pkg/cli.py", one).get(1), 1);
  const two = new Map([["pkg/__init__.py", new Map()], ["src/pkg/__init__.py", new Map()]]);
  assert.equal(matchCoverage("a/src/pkg/__init__.py", two), null);
});
test("fileCoverage counts only measured added lines", () => {
  const lines = new Map([[1, 1], [4, 0], [5, 3], [7, 0]]);
  assert.deepEqual(fileCoverage([1, 2, 3, 4, 7], lines), { measured: 3, missed: [4, 7] });
  assert.deepEqual(fileCoverage([2, 3], lines), { measured: 0, missed: [] });
  assert.equal(fileCoverage([1], null), null);
});
test("formatPct never rounds up to 100", () => {
  assert.equal(formatPct(199, 200), "99%");
  assert.equal(formatPct(200, 200), "100%");
  assert.equal(formatPct(1, 3), "33%");
});
test("coverageTone", () => {
  assert.equal(coverageTone(80, 80, 10), "ok");
  assert.equal(coverageTone(79.9, 80, 10), "warn");
  assert.equal(coverageTone(70, 80, 10), "warn");
  assert.equal(coverageTone(69.9, 80, 10), "bad");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/`
Expected: FAIL, because the region markers aren't found or the functions are undefined.

- [ ] **Step 3: Implement the region in `gh-pr-review-toolkit.user.js`**

Open it with the comment `// #region coverage-core — pure: no DOM, GM_* or toolkit state (tests/coverage-core.test.mjs evaluates this block)`.

- **`unzipText`**: port it from the spike (`docs/superpowers/specs/2026-10-21-new-line-coverage-spike.user.js`, `unzip`): EOCD scan, central directory, method 0/8 via `DecompressionStream("deflate-raw")`. Throw on a missing EOCD or a bad entry signature. Skip other methods.
- **`parseCobertura`**: regex, not DOMParser, so Node can run it.
  - `<source>([^<]*)</source>` gives the sources (trimmed, trailing `/` removed).
  - Each `<class …filename="…">…</class>` is one file. Decode `&amp; &lt; &gt; &quot; &apos;` in the filename.
  - Each `<line …>` inside it supplies `number` and `hits`, read as attributes in any order. Duplicate numbers (method lines) keep the max.
- **`addReport`**: keys are `${source}/${filename}` for every source, or the bare `filename` when `sources` is empty. Merge into existing maps with max hits.
- **`matchCoverage(path, index)`**:
  1. Strong keys are those where `k === path || k.endsWith("/" + path)`. Return the map of the shortest one.
  2. Otherwise, weak keys are those where `path.endsWith("/" + k)`. Return the map only when exactly one exists.
  3. Otherwise return `null`.
- **`formatPct`**: `Math.floor(100 * covered / measured) + "%"`.
- **`coverageTone`**: `pct >= threshold ? "ok" : pct >= threshold - margin ? "warn" : "bad"`.

Close the region with `// #endregion coverage-core`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add gh-pr-review-toolkit.user.js tests/coverage-core.test.mjs tests/fixtures/coverage
git commit -m "Add pure coverage core (unzip, Cobertura, path matching) with Node tests"
```

### Task 2: CI discovery parsers

**Files:**
- Modify: `gh-pr-review-toolkit.user.js` (inside the `coverage-core` region)
- Modify: `tests/coverage-core.test.mjs`
- Fixtures: `tests/fixtures/coverage/{status-details.json,run-artifacts.html}`

**Interfaces:**
- Produces:
  - `parseStatusDetails(json: object): { pending: boolean, failed: boolean, runIds: string[], jobIds: string[] }`. Only entries whose `targetUrl` matches `/\/actions\/runs\/(\d+)\/job\/(\d+)/` count. `runIds` is unique, in first-seen order. `jobIds` is sorted.
  - `parseArtifactRows(html: string): Array<{ id: string, name: string, sizeMB: number | null }>`

- [ ] **Step 1: Write the failing tests**

```js
test("parseStatusDetails keeps only Actions jobs", () => {
  const d = JSON.parse(readFileSync(fixture("status-details.json"), "utf8"));
  assert.deepEqual(parseStatusDetails(d), {
    pending: false, failed: false, runIds: ["39653514710"],
    jobIds: ["119408658405", "119408658536", "119408658646"],
  }); // the codecov "failure" is not an Actions job, so it doesn't count as failed
});
test("parseStatusDetails: pending and failed", () => {
  const d = JSON.parse(readFileSync(fixture("status-details.json"), "utf8"));
  const jobs = d.checkRuns.filter((r) => r.targetUrl.includes("/actions/runs/"));
  jobs[0].pending = true; jobs[0].state = "pending";
  jobs[1].state = "failure";
  assert.deepEqual([parseStatusDetails(d).pending, parseStatusDetails(d).failed], [true, true]);
  jobs[1].state = "skipped";
  assert.equal(parseStatusDetails(d).failed, false);
});
test("parseStatusDetails tolerates garbage", () => {
  assert.deepEqual(parseStatusDetails(null), { pending: false, failed: false, runIds: [], jobIds: [] });
});
test("parseArtifactRows reads id, name and size", () => {
  const rows = parseArtifactRows(readFileSync(fixture("run-artifacts.html"), "utf8"));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.find((r) => r.id === "12370044095"), { id: "12370044095", name: "Packages", sizeMB: 2.1 });
  assert.deepEqual(parseArtifactRows("<html></html>"), []);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/`
Expected: the new tests FAIL (functions not defined); the Task 1 tests still pass.

- [ ] **Step 3: Implement both parsers in the region and add them to the test harness's return list**

- **`parseStatusDetails`**:
  - `failed` = any Actions job that isn't pending and whose `state` isn't in `success`, `skipped` or `neutral`.
  - `pending` = any Actions job with `pending === true`.
- **`parseArtifactRows`**: split the HTML on `data-artifact-id="`. For each chunk (up to its `</tr>`):
  - `id` = the leading digits.
  - `name` = the text of the first element whose class includes `text-bold`, trimmed and entity-decoded.
  - `sizeMB` = the first `<td>` text matching `/([\d.]+)\s*(Bytes?|KB|MB|GB)/i`, converted to MB. `null` if there's no match.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add gh-pr-review-toolkit.user.js tests/coverage-core.test.mjs
git commit -m "Parse CI job status and run-page artifact rows for coverage"
```

### Task 3: Added lines, loader, cache and pruning

**Files:**
- Modify: `gh-pr-review-toolkit.user.js`:
  - header (`@connect`);
  - `DEFAULTS` (~line 23);
  - `pruneStalePrs` (~line 215);
  - `parseDiff` (~line 429);
  - `state` (~line 552), `loadData` (~line 613), `resetState` (~line 641);
  - new loader code right after `loadCommitOids`.

**Interfaces:**
- Consumes: Task 1 and 2 functions. Also `fetchText`, `loadCommitOids`, `digest`, `store`, `categoryOf`, `isGenerated`, `DAY_MS`, `PR_RETENTION_MS`.
- Produces:
  - `file.addedLines: number[]` on each `parseDiff` file. New-side line numbers of `+` lines; empty for `trivial` files.
  - `state.coverage`: `null | { status, head, progress?, run?, incomplete?, files?, noData?, error? }`.
    - `status` is `"loading" | "waiting" | "none" | "error" | "ready" | "quiet"`.
    - `files` is `Map<path, { measured, missed }>`.
    - `noData` is `string[]` (paths).
    - `"quiet"` means CI is still running in a repo with no coverage flag; nothing is rendered.
  - `loadCoverage(pr): Promise<void>`. It sets `state.coverage`, then does `state.version += 1; renderPanel(true); scan()` whenever the status changes.

- [ ] **Step 1: Extend `parseDiff`.** Add `addedLines: []` to `current`. In the `sign === "+"` branch, push `hunk.newLine` before it increments. In `endFile`, clear it when `current.trivial` is set.

- [ ] **Step 2: Config, header and prune**
  - Add `coverage: true` to `DEFAULTS.features`. Add `coverageArtifactPattern: "cov"`, `coverageThreshold: 80` and `coverageWarnMargin: 10` to `DEFAULTS`.
  - Add `// @connect      blob.core.windows.net` after the existing `@connect` lines.
  - In `pruneStalePrs`, add `GM_deleteValue(\`v3:coverage:${id}\`)` alongside the others. Then loop over `GM_listValues()`:
    - delete `v3:coverage:*` whose `.at` is older than `7 * DAY_MS`;
    - delete `v3:coverageRepo:*` whose value (a timestamp) is older than `PR_RETENTION_MS`.

- [ ] **Step 3: Write the loader** (constants `COVERAGE_POLL_MS = 60_000`, `MAX_ARTIFACT_MB = 50`, `DOWNLOAD_CONCURRENCY = 3`):
  - **`fetchBuffer(url): Promise<ArrayBuffer | null>`**: `GM_xmlhttpRequest` with `responseType: "arraybuffer"` and `timeout: 120_000`. Return `null` unless the status is 200.
  - **`loadCoverage(pr)`**:
    - Return early if `!config.features.coverage`.
    - Guard against overlapping calls for the same `pr.key`, and drop results if `state.pr?.key !== pr.key` afterwards (the same pattern as `loadData`).
    1. Get `head` (see Research). Fetch `/<o>/<r>/commit/<head>/status-details` with `loadCommitOids`'s headers and `JSON.parse` it inside try/catch. Run `parseStatusDetails`. Then `stamp = digest(jobIds.join())`.
    2. Cache: `entry = store.get(coverageKey)`. If `entry?.head === head && entry.stamp === stamp`, hydrate (step 6) and stop. Ignore an entry with a different `head`.
    3. If `pending`, set status `"waiting"` if `store.get(coverageRepoKey)` exists, else `"quiet"`. Schedule `loadCoverage(pr)` after `COVERAGE_POLL_MS`; clear that timer in `resetState`. Stop.
    4. Fetch each run page `/<o>/<r>/actions/runs/<id>` and `parseArtifactRows`. Keep rows matching `new RegExp(config.coverageArtifactPattern, "i")`; drop any with `sizeMB > MAX_ARTIFACT_MB` and count them as `skippedLarge`. If none remain, store `{ head, stamp, at: Date.now(), none: true }`, set status `"none"` and stop.
    5. Download in a pool of `DOWNLOAD_CONCURRENCY` from `/<o>/<r>/actions/runs/<run>/artifacts/<id>`, updating `progress: [done, total]` and re-rendering the panel. For each zip:
       - `unzipText(buf, n => /\.xml$/i.test(n))`;
       - for each file where `isCobertura(text)`, `addReport(index, parseCobertura(text))`.

       If a download fails or a zip won't parse, mark the result `incomplete`. If every download fails, set status `"error"`.
    6. For each `state.files` entry with `addedLines.length`, skipping `isGenerated` and `trivial`, call `fileCoverage(addedLines, matchCoverage(path, index))`:
       - non-null: record it in `files`;
       - null and `categoryOf(path) === "source"`: add to `noData`.

       Set `run` to the first run id that had a matching artifact.
       - **Hydrating from the cache:** map stored `digest(path)` keys back through `state.files`.
       - **Storing:** if `!failed && !incomplete`, write `{ head, stamp, at, run, files: {digest(path): {measured, missed}}, noData: [digest…] }`, then refresh `store.set(coverageRepoKey, Date.now())`. The repo flag is refreshed even when the result isn't cached.
       - `incomplete = failed || incomplete || skippedLarge > 0`.
  - Call `loadCoverage(pr)` at the end of `loadData` (after `renderPanel(true)`). Reset `state.coverage = null` in `resetState`.

- [ ] **Step 4: Verify on real PRs.** Reinstall the script (Tampermonkey → the installed script → replace with the file) and run `node --test tests/` (still green). Then check:
  - On a work PR with coverage: `state.coverage` reaches `"ready"`, with numbers matching the spike run (64/64 on the spike's PR). Inspect it by temporarily logging it to the console.
  - The Tampermonkey storage tab shows only `v3:coverage:<hash>` with numbers and hashes.
  - Reloading the page makes no artifact requests (check the Network panel for `/artifacts/`).
  - On a public repo PR without coverage (for example pytest-dev/pytest), the status is `"none"`.

- [ ] **Step 5: Commit**

```bash
git add gh-pr-review-toolkit.user.js
git commit -m "Load new-line coverage from CI artifacts with a hashed per-PR cache"
```

### Task 4: Coverage UI

**Files:**
- Modify: `gh-pr-review-toolkit.user.js`:
  - `FEATURE_GROUPS` Files group;
  - `processFile` (~line 855);
  - `jumpToLeftover` (~line 1668), renamed to `jumpToLine` with all call sites updated;
  - `INLINE_CLASSES` / `counterGroup` / `placeInlineIndicators` (~line 2054);
  - `buildSections` (~line 2174);
  - `SHORTCUTS` (~line 2493);
  - the keydown handler (~line 3527);
  - `scan` (~line 3261);
  - CSS (~line 3356).

**Interfaces:**
- Consumes: `state.coverage` (Task 3), `formatPct`, `coverageTone`, `badge`, `findLineRow`, `fileEntries`, `jumpToFile` (line 1317), `syncInline`, `counterGroup`, `inlineSection`/`section`, `goTo`, `tabHref`, `NAV_TABS`.
- Produces: `uncoveredList(): Array<{ path, line }>` (state.files order, lines ascending), `stepUncovered(direction: 1 | -1)`, `let uncoveredCursor = -1` (reset wherever `leftoverCursor` is reset and when coverage changes).

- [ ] **Step 1: Settings entry.** Files group: `{ key: "coverage", label: "New-line coverage from CI artifacts", hint: "Alt+U / Alt+Shift+U", note: "Cobertura XML in Actions artifacts; coverageArtifactPattern, coverageThreshold, coverageWarnMargin" }`.

- [ ] **Step 2: File badge** in `processFile` (only when `state.coverage?.status === "ready"`):
  - **File with `measured > 0`:** badge `` `${formatPct(measured - missed.length, measured)} covered` ``. Map tones `ok` → `done`, `warn` → `warn`, `bad` → `bad`. Title `Missed new lines: 57, 58, 112` or `All measured new lines covered`.
  - **Path in `noData`:** badge `no coverage data` in tone `bad`, title `Changed source file not found in any coverage report`.
  - **`measured === 0`:** no badge.

  Add CSS `.prr-bad { background: var(--bgColor-danger-muted, #ffebe9); color: var(--fgColor-danger, #d1242f); }`.

- [ ] **Step 3: Gutter marks.** Add `markUncovered()`, called at the end of `scan()`. For each file entry with missed lines, use `findLineRow(entry, line)` and add class `prr-uncovered` where it's missing. On coverage change, remove all `.prr-uncovered` first.

  Add CSS `.prr-uncovered > td:first-child, .prr-uncovered:not(tr) { box-shadow: inset 3px 0 0 var(--fgColor-danger, #d1242f); }`. Rows render lazily, so the repeated `scan` picks them up.

- [ ] **Step 4: Stepping and shortcut.**
  - Rename `jumpToLeftover` to `jumpToLine` and update its callers.
  - `stepUncovered` mirrors `stepLeftover`: toasts `No uncovered new lines` or `Coverage not loaded yet`, then calls `jumpToLine`.
  - In the keydown Files block: `config.features.coverage && event.code === "KeyU"` calls `stepUncovered(event.shiftKey ? -1 : 1)`.
  - `SHORTCUTS`: add `Alt+U` "Next uncovered new line" and `Alt+Shift+U` "Previous uncovered new line" (feature `coverage`, `filesOnly`).

- [ ] **Step 5: Inline counter.**
  - Add `"prr-inline-coverage"` to `INLINE_CLASSES` and to the `button:not(…)` list in `counterGroup`.
  - In `placeInlineIndicators`, when on the Files tab and `uncoveredList().length`, `syncInline("prr-inline-coverage", counter && counterGroup(counter), String(count), …, "before")` with a button `prr-badge prr-warn prr-inline-coverage`, text `${count} uncovered`, title `New lines no test ran: jump to the next (Alt+U)`, `onclick: () => stepUncovered(1)`.
  - Include it in the `counter` precondition, and style it alongside `.prr-inline-leftovers` in the CSS.

- [ ] **Step 6: Panel section "New-line coverage"** in `buildSections`, after the leftovers section. Its content depends on `state.coverage.status`:

  | Status | Content |
  |---|---|
  | `quiet` / `null` | nothing |
  | `loading` | `Loading coverage ${done}/${total}…` (or `Loading coverage…` before the total is known) |
  | `waiting` | `` Waiting for CI on `${head.slice(0, 7)}`… `` |
  | `none` | `` No coverage artifacts for `${sha7}` (CI may not upload them, or they've expired) `` |
  | `error` | `` Couldn't load coverage: ${error} `` |
  | `ready` | see below |

  The `ready` section has:
  - **Headline:** a badge with `` `${formatPct(c, m)} · ${c} / ${m} lines` ``, toned by `coverageTone(100 * c / m, …)`. If `m === 0`, show `No measured new lines` instead.
  - **Subline:** `CI run <a href="/<o>/<r>/actions/runs/<run>">#<run></a> · <sha7>`.
  - **If `incomplete`:** a `prr-warn` line, `A CI job failed or an artifact couldn't be read; coverage may be incomplete`.
  - **Attention rows**, worst first: `noData` paths first, then files with missed lines, by missed count descending.
    - Show 5 rows, then a `+ N more` button that toggles a module-level `coverageExpanded` flag and calls `renderPanel(true)`.
    - Each row shows the file name, with the full path in its title, and a badge (`no data`, or `` `${pct} · ${missed.length} missed` ``).
    - Clicking a row calls `jumpToLine({ path, line: missed[0] })`, or `jumpToFile(path)` for no data. The off-Files-tab behavior is the same as leftovers.
  - **Footer** (`prr-muted`): `${fully} files fully covered · ${notMeasured} tests/config not measured`. `notMeasured` = changed files with added lines that are neither in `files` nor in `noData`.

- [ ] **Step 7: Verify in the browser.** Run `node --test tests/` (green). On the work PR, check:
  - badges and tones match the panel;
  - temporarily setting `coverageThreshold: 101` in the config JSON turns them amber or red;
  - Alt+U walks the missed lines and expands collapsed files;
  - the inline counter appears next to "N / M viewed";
  - the panel shows on the Conversation tab;
  - turning the feature off removes every trace;
  - a PR on a repo without coverage shows only the one-line note.

- [ ] **Step 8: Commit**

```bash
git add gh-pr-review-toolkit.user.js
git commit -m "Show new-line coverage: file badges, uncovered-line marks, Alt+U, panel section"
```

### Task 5: Docs and version

**Files:**
- Modify: `README.md`, `gh-pr-review-toolkit.user.js` (header `@version`)

- [ ] **Step 1: README**
  - Install step 3: add `blob.core.windows.net` to the hosts Tampermonkey asks about.
  - Shortcuts table: add `Alt+U` / `Alt+Shift+U`.
  - New `<details>` under Files, "New-line coverage": what it shows, the three config keys and their defaults, the tone rule, and that only Cobertura is supported for now.
  - "How data is loaded": rows for `/commit/<sha>/status-details`, `/actions/runs/<id>` and `/actions/runs/<id>/artifacts/<id>` (only with the feature on, once per head commit and CI job set; zips are read in memory and never stored).
  - Change "Up to three requests per PR" accordingly.
  - A "What coverage needs from CI" note:
    - upload Cobertura XML with `actions/upload-artifact` in an artifact whose name matches `coverageArtifactPattern`;
    - check out the PR head (example: `ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}`);
    - for Vitest, Istanbul `coverage-final.json` is planned.
  - Storage note: hashed per-PR numbers, replaced on each new head, pruned after 7 days; a repo flag pruned after 90 days.
- [ ] **Step 2: Bump `@version` to `0.17.0`** (a new feature; the CI action only bumps the patch).
- [ ] **Step 3: Run `node --test tests/`** and expect it to pass. Mention the test command under README "Maintenance notes".
- [ ] **Step 4: Commit**

```bash
git add README.md gh-pr-review-toolkit.user.js
git commit -m "Document new-line coverage and bump to 0.17.0"
```
