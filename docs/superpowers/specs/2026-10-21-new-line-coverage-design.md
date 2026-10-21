# New-line coverage in the PR Review Toolkit

## Intent

When reviewing a PR, answer "is this PR adding code that no test runs?" without leaving the page. Show a coverage percentage for the PR and for each changed file, and point at the specific new lines that weren't covered.

Only lines **added in the PR** count. A file's overall coverage, and coverage of lines the PR didn't touch, are out of scope.

The data comes from coverage reports the repo's CI already uploads as GitHub Actions artifacts. The toolkit only reads and displays it.

## Goals

- PR-level new-line coverage: covered / measured added lines, as a percentage.
- Per-file new-line coverage for changed source files.
- Uncovered new lines are visible in the diff and reachable by keyboard.
- Works with tests split across several CI jobs and several artifacts (merge them).
- Works with only the signed-in browser session. No API token, the same as the rest of the toolkit.

## Non-goals

- Producing coverage. If CI doesn't upload a report, the feature has nothing to show.
- Coverage formats other than Cobertura XML in v1 (see [Later](#later)).
- Whole-file or whole-repo coverage, trends, or comparing against the base branch.
- Coverage badges on PR list pages.
- Guessing coverage from the diff, such as whether tests mention a function. It has to be real execution data or nothing.

## Anti-goals (would be a failure even if it "works")

- **Storing the content of any report or code.** Persisted data must be limited to numbers, salted hashes and commit SHAs (see [Storage](#storage)).
- **Showing coverage from an older commit on the current diff.** Line numbers shift between pushes, so red marks would land on the wrong lines. Stale data is never laid over the diff.
- **Silently treating unmeasured source as covered.** A changed source file with no coverage data must say "no coverage data", not disappear from the numbers unnoticed.
- **Breaking or slowing the toolkit on repos with no coverage artifacts.** There it should stay quiet: one line in the panel, no badges.

## Proven by the spike

A throwaway userscript was run on a real work PR (Python monorepo, pytest-cov), on 2026-10-21. It confirmed:

1. **Finding runs:** `GET https://github.com/<owner>/<repo>/pull/<n>/checks` (HTML) contains links matching `/actions/runs/(\d+)`, which give the run ids for the PR.
2. **Listing artifacts:** `GET https://github.com/<owner>/<repo>/actions/runs/<run_id>` (HTML) has one row per artifact: an element with `data-artifact-id="<id>"`, the name in a descendant `.text-bold`, and the size in the second `<td>` (for example `2.1 MB`).
3. **Downloading with the session cookie works.** `GET https://github.com/<owner>/<repo>/actions/runs/<run_id>/artifacts/<artifact_id>` via `GM_xmlhttpRequest` with `responseType: "arraybuffer"` redirects (through `/suites/<id>/artifacts/<id>`) to `productionresultssa<N>.blob.core.windows.net` and returns the zip with status 200. Observed: 1.77 MB in about 2.6 s.
4. **Unzipping without a library works.** Read the zip's central directory (EOCD signature `0x06054b50`, central entries `0x02014b50`), then inflate method-8 entries with `new DecompressionStream("deflate-raw")`. Method 0 is stored as-is.
5. **Report shape:** pytest-cov writes Cobertura XML (for example `.test-cov/<pkg>-coverage.xml`). One artifact held about 20 Cobertura files. Each has `<sources><source>` holding absolute runner paths like `/home/runner/work/<repo>/<repo>/capabilities/<pkg>/src`, plus `<class filename="…">` with `<line number hits>` entries.
6. **Path matching:** join each `<source>` with each class `filename`, then match against PR paths by suffix. A PR path `p` matches report key `k` when `k === p` or `k.endsWith("/" + p)`. This lined up correctly on the real PR. **For production** *(my call, from builder review)*: keep the bare `filename` only when a report has no `<source>`. Keep the spike's weaker fallback (`p.endsWith("/" + k)`) only when **exactly one** key matches. If several match, treat the file as "no data", so a same-named file in another package can never lend it coverage.
7. **The numbers make sense:** 193 added lines in one file, of which 59 were measured. Blank lines, comments and docstrings aren't in the report and correctly fall out of the denominator.

The spike source is kept for reference at `docs/superpowers/specs/2026-10-21-new-line-coverage-spike.user.js`. It is reference only, not production code.

## Design

### Where it lives

A new feature in `gh-pr-review-toolkit.user.js`, with key `coverage` in `DEFAULTS.features` (default `true`), listed in the **Files** group in `FEATURE_GROUPS`. On repos without matching artifacts, it costs one checks-page fetch plus one fetch per run page, once per head commit after CI finishes (see [Staying quiet](#staying-quiet-on-repos-without-coverage-my-call-from-builder-review)). It shows a one-line panel note.

### Configuration (in `DEFAULTS`, editable via the settings modal / config JSON)

- `coverageArtifactPattern`: a regex string matched case-insensitively against artifact names. Default `"cov"`. *(My call.)*
- `coverageThreshold`: a percentage, default `80`. At 100% the badge is green ("ok"); from the threshold up to 100% it's amber ("warn"); below the threshold it's red. *(The user asked for this to be a setting. 80 as the default is my call.)*

### Data flow

1. **Added lines per file.** `parseDiff` currently keeps counts and drops the hunk text. Extend it to also keep, per file, the new-side line numbers of added lines (`addedLines: number[]`). Only numbers, no text. Skip files the toolkit already treats as generated or trivial.
2. **Head commit.** The coverage must belong to the PR's current head SHA. Get it from the same source the toolkit already uses for `commitOids` (`/pull/<n>/commits` JSON), or from the checks page. The builder picks, but it must work when `sinceLastLook` is off.
3. **Cache check** (see [Storage](#storage)). If there's a stored entry for this PR with the same head SHA, use it and stop.
4. **Find runs** for the head SHA from the checks page (spike step 1). Only use runs whose commit is the current head. The run page shows the commit; the builder confirms the exact markup.
5. **List artifacts** for each run, keep those whose name matches `coverageArtifactPattern` and that haven't expired.
6. **Download** matching artifacts, at most 3 at a time *(my call)*. The panel shows progress ("Loading coverage 2/5…").
7. **Unzip and parse.** For each `.xml` entry whose first ~2 KB contains `<coverage`, parse it as Cobertura. Merge across all files and artifacts into `path → Map(line → hits)`, keeping the **maximum** hits for each line. A line counts as covered if any job ran it.
8. **Intersect with added lines.** For each changed file, `measured` = added lines present in the report, and `missed` = measured lines with 0 hits. A file with no matching report entry is "no data".
9. **Save** the result (only the numbers) to storage, then render.

Downloaded zips and XML exist only in memory during processing and are never persisted.

### When a result is final *(my call, from builder review)*

- Compute coverage only once **every** Actions run for the head SHA has completed. While any are still running, stay in the "waiting" state, even if some artifacts have already been uploaded, because a partial merge would show lines as missed that a later job covers.
- The cache is keyed by head SHA **plus** each run's id and attempt number. Re-running a failed job creates a new attempt, so the cached entry no longer matches and coverage is recomputed.
- Results flagged "may be incomplete" (a job failed) are shown but **not cached**, so a successful re-run replaces them.

### Staying quiet on repos without coverage *(my call, from builder review)*

- Store a per-repo flag, `v3:coverageRepo:<digest(owner/repo)>`, holding a timestamp. It's set the first time matching coverage artifacts are found in that repo. The "Waiting for CI…" state and the 60 s re-check only happen in repos with this flag. Elsewhere, while CI runs, the panel shows nothing about coverage.
- When CI has finished and nothing matched, store `{ head, none: true }` in the PR's coverage entry (a SHA only, no content), so the run pages aren't fetched again on every page load for that head.
- The repo flag is pruned with the other entries if it hasn't been refreshed in 90 days.

### States (panel message, no diff marks)

| Situation | Behavior |
|---|---|
| CI for the head commit still running, no coverage yet | Panel: "Waiting for CI on `<short sha>`…". Re-check about every 60 s while the tab is open and the PR head hasn't changed, then fill in on its own. |
| CI finished, no artifact matches the pattern | One panel line saying no coverage artifacts were found, naming the runs checked. No badges. |
| Matching artifacts have expired | Panel says the coverage artifacts have expired. |
| A test job failed but coverage was uploaded | Show the coverage, with a warning that it may be incomplete. |
| A download or parse fails | Panel says coverage couldn't be loaded. The rest of the toolkit is unaffected, the same as the existing diff-failure behavior. |

Coverage from a previous head commit is **never** shown on the current diff.

### Which files count

- **Source files with data:** counted in the PR totals, badge, and line marks.
- **Source files with no data:** "no coverage data" badge (red). Listed at the top of the panel's attention list. Not part of the percentage, which only covers measured lines, but always visible.
- **Tests, docs, config and generated files** (by the toolkit's existing `categoryOf` / `isGenerated`) with no data: ignored. No badge, and only counted in the panel's "not measured" summary line.

### UI

Modeled on the existing debug-leftovers feature, reusing `badge()`, `revealLine`, `flash`, `toast`, `section()` and the inline-counter placement.

**File header badge** (Files tab), on each changed source file:
- "NN% covered", with tone from `coverageThreshold`. Its `title` lists the missed line numbers.
- "no coverage data" for source files with no data.

**Line marks:** only **uncovered** added lines get a red marker in the gutter. Covered lines and lines that aren't code are not marked. *(User choice: option A.)* Use the same row lookup leftovers use (`findLineRow`). Re-apply when GitHub renders rows lazily.

**Inline counter** on the Files tab, before GitHub's "N / M viewed" next to the leftovers badge: an "N uncovered" badge. Clicking it jumps to the next uncovered line. Hidden when 0.

**Shortcut:** Alt+U / Alt+Shift+U for next / previous uncovered line (*my pick of key*; check it doesn't clash). Register it like the leftovers shortcuts in the shortcut list, and expand collapsed files the same way `stepLeftover` does. From another tab, go to the Files tab at that line, the same as `jumpToLeftover`.

**Panel section "New-line coverage"** (shows on every PR tab). *(User choice: option A.)*
- Headline: "84% · 412 / 490 lines", toned by threshold.
- Subline: CI run number and short head SHA it came from.
- An attention list, worst first: source files with no data, then files with misses by missed-line count. Each row is a short path and a badge ("31% · 22 missed" / "no data"). Show at most 5, then a "+ N more" control that expands the rest. Clicking a row jumps to that file's first uncovered line, or to the file for "no data".
- A footer line: "N files fully covered · M tests/config not measured".
- In the non-data states, only the state message.

### Storage

Tampermonkey storage, following the toolkit's existing privacy pattern (salted `digest()`, `gh-pr-review-toolkit.user.js:204`):

```
v3:coverage:<digest(pr.key)> → {
  head: "<head commit sha>",
  at: <Date.now() when computed>,
  files: { "<digest(path)>": { measured: <number>, missed: [<line>, …] } , … },
  noData: ["<digest(path)>", …],
  run: <run number for the subline>
}
```

- **One entry per PR.** Computing coverage for a new head commit overwrites that PR's entry, so old data for the PR is cleared at that moment. *(User requirement.)*
- **No paths, code, repo names or report content** are stored. Paths are matched back by digesting the PR's current file paths. *(User requirement.)*
- Don't store the "waiting" or "no artifacts" states, only completed results.
- **Expiry for PRs never revisited:** add `GM_deleteValue(\`v3:coverage:${id}\`)` to `pruneStalePrs` with the others, and call `touchPr(id)` when writing. Also drop any coverage entry whose `at` is older than 7 days during that daily prune *(my call; the cache only saves a re-download)*.

### Permissions and docs

- Add `// @connect blob.core.windows.net` to the header. Don't use `*`.
- README:
  - a feature entry under Files;
  - rows in "How data is loaded" for the checks page, run pages and artifact downloads, saying they're only made when the feature is on, once per head commit;
  - a "What coverage needs from CI" note: upload Cobertura XML with `actions/upload-artifact`, using an artifact name that matches the pattern. The test job must also check out the PR **head** commit, not GitHub's default test-merge commit, or line numbers can drift when the base branch has moved. The user's work repo already does this: `ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}`. The toolkit can't detect a merge-commit checkout, so this is a documented requirement, not something it checks;
  - a note on what's stored and for how long.
- First install / update: Tampermonkey will ask to allow `blob.core.windows.net`. Mention this in the Install section's list of hosts.

## Left to the builder

- The exact checks-page / run-page parsing beyond what the spike proved, including how to confirm a run's head SHA and detect "still running", "expired" and "failed".
- How to get the head SHA when `sinceLastLook` is off.
- Gutter-marker styling and re-applying marks on lazily rendered rows.
- Concurrency and timeout details, and very large artifacts (skip anything over ~50 MB with a panel note, *my suggestion*).
- Tests: the repo has no test suite. Verify with a real PR, as the spike did.

## Later

- **Istanbul `coverage-final.json`** (Vitest with `@vitest/coverage-v8`, reporter `json`) for the React repo. That repo's CI doesn't upload coverage yet. It needs an `actions/upload-artifact` step for `coverage/coverage-final.json` first. Line hits = the most hits among statements that start on that line.
- lcov, if a repo needs it.
