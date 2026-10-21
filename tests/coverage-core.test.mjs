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
const { unzipText, isCobertura, parseCobertura, addReport, matchCoverage, fileCoverage, formatPct, coverageTone } = new Function(
  `${source.slice(start, end)}\nreturn { unzipText, isCobertura, parseCobertura, addReport, matchCoverage, fileCoverage, formatPct, coverageTone };`,
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

test("addReport joins sources and keeps max hits across reports", () => {
  const index = new Map();
  addReport(index, parseCobertura(coverageXml()));
  addReport(index, parseCobertura(coverageXml().replace('number="4" hits="0"', 'number="4" hits="2"')));
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
