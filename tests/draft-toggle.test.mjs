// Runs the PR list's "Is draft" query toggle: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../gh-pr-review-toolkit.user.js", import.meta.url), "utf8");
const line = (name) => {
  const found = source.match(new RegExp(`^\\s*const ${name} = .*$`, "m"))?.[0];
  if (!found) throw new Error(`${name} not found in gh-pr-review-toolkit.user.js`);
  return found;
};
const { isDraftOn, toggleDraftQuery } = new Function(`${line("isDraftOn")}\n${line("toggleDraftQuery")}\nreturn { isDraftOn, toggleDraftQuery };`)();

test("turning drafts on appends draft:true", () => {
  assert.equal(toggleDraftQuery("is:pr is:open"), "is:pr is:open draft:true");
});

test("turning drafts on replaces draft:false", () => {
  assert.equal(toggleDraftQuery("is:pr draft:false is:open"), "is:pr is:open draft:true");
});

test("turning drafts off removes draft:true and is:draft wherever they are", () => {
  assert.equal(toggleDraftQuery("is:pr draft:true is:open"), "is:pr is:open");
  assert.equal(toggleDraftQuery("is:pr IS:DRAFT author:@me"), "is:pr author:@me");
});

test("isDraftOn reads both spellings and ignores draft:false", () => {
  assert.equal(isDraftOn("is:pr draft:true"), true);
  assert.equal(isDraftOn("is:pr is:draft"), true);
  assert.equal(isDraftOn("is:pr draft:false"), false);
  assert.equal(isDraftOn(""), false);
});

test("toggling twice round-trips", () => {
  const q = "is:pr is:open label:bug";
  assert.equal(toggleDraftQuery(toggleDraftQuery(q)), q);
});
