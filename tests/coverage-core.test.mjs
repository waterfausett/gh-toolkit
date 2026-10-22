// Runs the userscript's pure coverage-core region in Node: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const fixture = (name) => fileURLToPath(new URL(`tests/fixtures/coverage/${name}`, root));

const source = readFileSync(new URL("gh-pr-review-toolkit.user.js", root), "utf8");
const start = source.indexOf("// #region coverage-core");
const end = source.indexOf("// #endregion coverage-core");
if (start < 0 || end < 0) throw new Error("coverage-core region markers not found in gh-pr-review-toolkit.user.js");
const { unzipText, isCobertura, parseCobertura, createCoverageIndex, addReport, matchCoverage, coveredExtensions, fileCoverage, formatPct, coverageTone, parseStatusDetails, parseArtifactRows, coverageSummary, coverageChip, diffSideOf, coverageTrigger } = new Function(
  `${source.slice(start, end)}\nreturn { unzipText, isCobertura, parseCobertura, createCoverageIndex, addReport, matchCoverage, coveredExtensions, fileCoverage, formatPct, coverageTone, parseStatusDetails, parseArtifactRows, coverageSummary, coverageChip, diffSideOf, coverageTrigger };`,
)();

const coverageXml = () => readFileSync(fixture("pkg-coverage.xml"), "utf8");

test("unzipText inflates wanted entries and skips the rest", async () => {
  const b = readFileSync(fixture("artifact.zip"));
  const files = await unzipText(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), (n) => n.endsWith(".xml"));
  assert.deepEqual(files.map((f) => f.name), [".test-cov/pkg-coverage.xml", ".test-cov/junit.xml"]);
  assert.equal(files[0].text, coverageXml());
});

test("unzipText rejects a non-zip", async () => {
  await assert.rejects(unzipText(new TextEncoder().encode("<html>").buffer, () => true));
});

test("isCobertura", () => {
  assert.equal(isCobertura(coverageXml()), true);
  assert.equal(isCobertura("<testsuites/>"), false);
});

test("parseCobertura reads sources and per-line hits", () => {
  const r = parseCobertura(coverageXml());
  assert.deepEqual(r.sources, ["/home/runner/work/repo/repo/capabilities/pkg/src"]);
  assert.equal(r.files[0].filename, "pkg/cli.py");
  assert.deepEqual([...r.files[0].lines], [[1, 1], [2, 1], [4, 0], [5, 3], [7, 0], [8, 1]]);
});

// A pytest-cov-shaped report; `sources` empty means no <source> element.
const report = (sources, files) => ({ sources, files: files.map(([filename, lines]) => ({ filename, lines: new Map(lines) })) });

test("addReport joins sources and keeps max hits across reports", () => {
  const index = createCoverageIndex();
  addReport(index, parseCobertura(coverageXml()), "a.xml");
  addReport(index, parseCobertura(coverageXml().replace('number="4" hits="0"', 'number="4" hits="2"')), "b.xml");
  const lines = index.lines.get("/home/runner/work/repo/repo/capabilities/pkg/src/pkg/cli.py");
  assert.equal(lines.get(4), 2);
  assert.equal(lines.get(7), 0);
  assert.equal(index.lines.has("pkg/cli.py"), false); // bare filename only when a report has no <source>
});

test("matchCoverage anchors absolute report paths on the inferred checkout root", () => {
  const index = createCoverageIndex();
  const root = "/home/runner/work/repo/repo";
  addReport(index, report([`${root}/capabilities/pkg/src`], [["pkg/cli.py", [[1, 1]]], ["pkg/fill.py", [[1, 0]]]]), "pkg.xml");
  addReport(index, report([`${root}/services/x`], [["main.py", [[1, 1]]]]), "x.xml");
  const matched = matchCoverage(["capabilities/pkg/src/pkg/cli.py", "capabilities/pkg/src/pkg/fill.py", "services/x/main.py", "main.py", "nope.py"], index);
  assert.equal(matched.get("capabilities/pkg/src/pkg/cli.py").get(1), 1);
  assert.equal(matched.get("services/x/main.py").get(1), 1);
  assert.equal(matched.get("main.py"), null); // a root-level main.py must not borrow services/x/main.py
  assert.equal(matched.get("nope.py"), null);
});

test("matchCoverage: relative keys are trusted only when unique and from one report", () => {
  const one = createCoverageIndex();
  addReport(one, report([], [["pkg/cli.py", [[1, 1]]]]), "a.xml");
  addReport(one, report([], [["pkg/cli.py", [[1, 0]]]]), "a.xml"); // the same report from another matrix job
  assert.equal(matchCoverage(["a/src/pkg/cli.py"], one).get("a/src/pkg/cli.py").get(1), 1);

  const collided = createCoverageIndex();
  addReport(collided, report(["src"], [["pkg/__init__.py", [[1, 1]]]]), "a/coverage.xml");
  addReport(collided, report(["src"], [["pkg/__init__.py", [[1, 1]]]]), "b/coverage.xml");
  assert.equal(matchCoverage(["b/src/pkg/__init__.py"], collided).get("b/src/pkg/__init__.py"), null);

  const two = createCoverageIndex();
  addReport(two, report([], [["pkg/__init__.py", []], ["src/pkg/__init__.py", []]]), "a.xml");
  assert.equal(matchCoverage(["a/src/pkg/__init__.py"], two).get("a/src/pkg/__init__.py"), null);
});

test("coveredExtensions lists the file types the reports measure", () => {
  const index = createCoverageIndex();
  addReport(index, parseCobertura(coverageXml()), "a.xml");
  assert.deepEqual([...coveredExtensions(index)], [".py"]);
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

const statusDetails = () => JSON.parse(readFileSync(fixture("status-details.json"), "utf8"));

test("parseStatusDetails keeps only Actions jobs", () => {
  // The codecov "failure" is not an Actions job, so it doesn't count as failed.
  assert.deepEqual(parseStatusDetails(statusDetails()), {
    pending: false,
    failed: false,
    runIds: ["39653514710"],
    jobIds: ["119408658405", "119408658536", "119408658646"],
  });
});

test("parseStatusDetails: pending and failed", () => {
  const d = statusDetails();
  const jobs = d.checkRuns.filter((r) => r.targetUrl.includes("/actions/runs/"));
  jobs[0].pending = true;
  jobs[0].state = "pending";
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

test("coverageSummary totals measured lines and orders the attention list worst first", () => {
  const files = new Map([
    ["a/full.py", { measured: 10, missed: [] }],
    ["a/some.py", { measured: 10, missed: [3] }],
    ["a/many.py", { measured: 20, missed: [1, 2, 9] }],
    ["a/comments.py", { measured: 0, missed: [] }],
  ]);
  const s = coverageSummary(files, ["a/new.py"]);
  assert.equal(s.measured, 40);
  assert.equal(s.covered, 36);
  assert.equal(s.fully, 1);
  assert.deepEqual(s.attention.map((r) => r.path), ["a/new.py", "a/many.py", "a/some.py"]);
  assert.equal(s.attention[0].noData, true);
});

test("coverageChip shows the PR percentage, with file and line counts in the tooltip", () => {
  const files = new Map([
    ["a/full.py", { measured: 10, missed: [] }],
    ["a/some.py", { measured: 10, missed: [3] }],
    ["a/many.py", { measured: 20, missed: [1, 2, 9] }],
  ]);
  const hint = "\nClick or Alt+U: jump to the next uncovered line";
  assert.deepEqual(coverageChip(coverageSummary(files, ["a/new.py"])), {
    text: "90% covered",
    title: `3 uncovered files · 4 uncovered new lines · 1 file with no coverage data${hint}`,
  });
  assert.deepEqual(coverageChip(coverageSummary(new Map([["a/some.py", { measured: 10, missed: [3] }]]), [])), {
    text: "90% covered",
    title: `1 uncovered file · 1 uncovered new line${hint}`,
  });
  assert.deepEqual(coverageChip(coverageSummary(new Map(), ["a/new.py"])), {
    text: "no coverage data",
    title: `1 uncovered file · 1 file with no coverage data${hint}`,
  });
  assert.deepEqual(coverageChip(coverageSummary(new Map([["a/full.py", { measured: 10, missed: [] }]]), [])), {
    text: "100% covered",
    title: "All measured new lines covered",
  });
  assert.equal(coverageChip(coverageSummary(new Map([["a/comments.py", { measured: 0, missed: [] }]]), [])), null);
});

test("diffSideOf trusts data-diff-side over class names", () => {
  // GitHub's newer diff view puts a right-side line number in a cell classed "...-left-side".
  assert.equal(diffSideOf("focusable-grid-cell new-diff-line-number-left-side", "right"), "R");
  assert.equal(diffSideOf("focusable-grid-cell new-diff-line-number-right-side", "left"), "L");
  assert.equal(diffSideOf("blob-num blob-num-deletion js-linkable-line-number", undefined), "L");
  assert.equal(diffSideOf("blob-num blob-num-addition js-linkable-line-number js-blob-rnum", undefined), "R");
});

test("coverageTrigger loads only on request or, in auto mode, on the Files tab", () => {
  assert.equal(coverageTrigger({ auto: true, onFilesTab: true, requested: false }), "load");
  assert.equal(coverageTrigger({ auto: true, onFilesTab: false, requested: false }), "cached");
  assert.equal(coverageTrigger({ auto: false, onFilesTab: true, requested: false }), "cached");
  assert.equal(coverageTrigger({ auto: false, onFilesTab: false, requested: true }), "load");
});
