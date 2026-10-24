// Runs the userscript's diff-line region against hand-built diff rows: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../gh-pr-review-toolkit.user.js", import.meta.url), "utf8");
const region = (name) => {
  const start = source.indexOf(`// #region ${name}`);
  const end = source.indexOf(`// #endregion ${name}`);
  if (start < 0 || end < 0) throw new Error(`${name} region markers not found in gh-pr-review-toolkit.user.js`);
  return source.slice(start, end);
};
const cellSideLine = source.match(/^\s*const cellSide = .*$/m)?.[0];
if (!cellSideLine) throw new Error("cellSide not found in gh-pr-review-toolkit.user.js");
const { diffLine } = new Function(`${region("coverage-core")}\n${cellSideLine}\n${region("diff-line")}\nreturn { diffLine };`)();

// Just enough of Element for diffLine: simple selectors (tag, .class, [attr], [attr*='v' i]) joined by commas.
const matchesSimple = (el, sel) =>
  (sel.match(/^[a-z]+/i)?.[0] ?? el.tag) === el.tag &&
  [...sel.matchAll(/\.([\w-]+)/g)].every(([, c]) => el.classList.includes(c)) &&
  [...sel.matchAll(/\[([\w-]+)(?:\*='([^']*)'( i)?)?\]/g)].every(([, attr, part, i]) => {
    const value = el.getAttribute(attr);
    if (value == null || part == null) return value != null;
    return i ? value.toLowerCase().includes(part.toLowerCase()) : value.includes(part);
  });

class El {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = { ...attrs };
    this.children = [];
    this.parent = null;
    children.forEach((child) => this.append(child));
  }
  append(child) {
    if (typeof child === "string") child = { text: child, parent: this };
    else child.parent = this;
    this.children.push(child);
  }
  get className() { return this.attrs.class ?? ""; }
  get classList() { return this.className.split(/\s+/).filter(Boolean); }
  get dataset() {
    return Object.fromEntries(Object.entries(this.attrs).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()), v]));
  }
  getAttribute(name) { return name === "class" ? this.attrs.class ?? null : this.attrs[name] ?? null; }
  hasAttribute(name) { return this.getAttribute(name) != null; }
  get elements() { return this.children.filter((child) => child instanceof El); }
  get nextElementSibling() {
    const siblings = this.parent?.elements ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get textContent() { return this.children.map((child) => (child instanceof El ? child.textContent : child.text)).join(""); }
  matches(selector) { return selector.split(",").some((sel) => matchesSimple(this, sel.trim())); }
  querySelectorAll(selector) { return this.elements.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  cloneNode() { return new El(this.tag, this.attrs, this.children.map((child) => (child instanceof El ? child.cloneNode() : child.text))); }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
}
const el = (tag, attrs, ...children) => new El(tag, attrs, children);

// GitHub's current diff view (React): the code cell repeats the side's data-line-number and data-diff-side.
const numCell = (side, n) => el("td", { class: "focusable-grid-cell new-diff-line-number left-side", "data-diff-side": side, "data-line-number": String(n) }, String(n));
const emptyNumCell = () => el("td", { class: "focusable-grid-cell new-diff-line-number empty-diff-line left-side" });
const codeCell = (side, n, marker, text) =>
  el("td", { class: "diff-text-cell focusable-grid-cell", "data-diff-side": side, "data-line-number": String(n) },
    el("code", { class: `diff-text ${marker === "-" ? "deletion" : "addition"}` }, el("span", { class: "diff-text-marker" }, marker), el("div", { class: "diff-text-inner" }, text)));

test("diffLine reads an added line in the current unified view", () => {
  const code = codeCell("right", 7, "+", "const total = 1;");
  const cell = numCell("right", 7);
  const row = el("tr", { class: "diff-line-row" }, emptyNumCell(), cell, code);
  const line = diffLine(row);
  assert.equal(line?.n, 7);
  assert.equal(line.cell, cell);
  assert.equal(line.code, code);
  assert.equal(line.text, "const total = 1;");
});

test("diffLine reads the new side of a current split-view row", () => {
  const cell = numCell("right", 19);
  const row = el("tr", { class: "diff-line-row" }, numCell("left", 19), codeCell("left", 19, "-", "old"), cell, codeCell("right", 19, "+", "new"));
  const line = diffLine(row);
  assert.equal(line?.n, 19);
  assert.equal(line.cell, cell);
  assert.equal(line.text, "new");
});

test("diffLine flags a deleted line in the current unified view", () => {
  const row = el("tr", { class: "diff-line-row" }, numCell("left", 4), emptyNumCell(), codeCell("left", 4, "-", "gone"));
  assert.deepEqual(diffLine(row), { deleted: true });
});

// Classic view: number cells carry data-line-number, the code cell doesn't.
test("diffLine reads a classic-view row", () => {
  const cell = el("td", { class: "blob-num blob-num-addition", "data-line-number": "12" });
  const code = el("td", { class: "blob-code blob-code-addition" }, el("span", { class: "blob-code-inner blob-code-marker", "data-code-marker": "+" }, "return x;"));
  const row = el("tr", {}, el("td", { class: "blob-num blob-num-addition empty-cell" }), cell, code);
  const line = diffLine(row);
  assert.equal(line?.n, 12);
  assert.equal(line.cell, cell);
  assert.equal(line.code, code);
  assert.equal(line.text, "return x;");
});

test("diffLine flags a classic-view deletion", () => {
  const row = el("tr", {}, el("td", { class: "blob-num blob-num-deletion", "data-line-number": "3" }), el("td", { class: "blob-num blob-num-deletion empty-cell" }), el("td", { class: "blob-code blob-code-deletion" }, el("span", { class: "blob-code-inner" }, "gone")));
  assert.deepEqual(diffLine(row), { deleted: true });
});
