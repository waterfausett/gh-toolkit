// Runs the PR list's saved-search query comparison: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../gh-pr-review-toolkit.user.js", import.meta.url), "utf8");
const line = (name) => {
  const found = source.match(new RegExp(`^\\s*const ${name} = .*$`, "m"))?.[0];
  if (!found) throw new Error(`${name} not found in gh-pr-review-toolkit.user.js`);
  return found;
};
const { sameQuery } = new Function(`${line("normalizeQuery")}\n${line("sameQuery")}\nreturn { sameQuery };`)();

test("is:open matches the state:open GitHub refills the box with", () => {
  assert.equal(sameQuery("is:pr is:open author:@me", "is:pr state:open author:@me"), true);
  assert.equal(sameQuery("is:pr state:closed", "is:pr is:closed"), true);
});

test("open and closed stay different", () => {
  assert.equal(sameQuery("is:pr is:open", "is:pr state:closed"), false);
});

test("whitespace differences don't matter", () => {
  assert.equal(sameQuery("  is:pr   is:open ", "is:pr state:open"), true);
});

test("other terms still compare exactly", () => {
  assert.equal(sameQuery("is:pr is:open tax OR VAT", "is:pr state:open tax or VAT"), false);
  assert.equal(sameQuery("is:pr is:open author:@me", "is:pr state:open"), false);
  assert.equal(sameQuery("is:pr is:merged", "is:pr state:merged"), false);
});
