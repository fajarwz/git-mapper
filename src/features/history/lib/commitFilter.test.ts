// findMatches behaviour: tokens, case folding, field coverage, nothing for a blank query.
import assert from "node:assert/strict";
import { test } from "vitest";

import { findMatches, splitByTokens } from "./commitFilter";
import type { Commit } from "../../../types";

/** A minimal commit-shaped row; everything not under test is blank. */
function commit(fields: Partial<Commit>): Commit {
  return {
    hash: fields.hash ?? "aaaa1111",
    subject: fields.subject ?? "",
    body: fields.body,
    author: fields.author ?? "",
    authorEmail: fields.authorEmail ?? "",
    date: fields.date ?? "2026-10-25T10:00:00+07:00",
    lane: 0,
    branchColor: 0,
    parents: fields.parents ?? [],
    refs: fields.refs ?? [],
  };
}

const rows = [
  commit({ hash: "aaaa1111", subject: "feat: add the lane cap", body: "MAX_LANES is hard" }),
  commit({ hash: "bbbb2222", subject: "fix: stop the flash restart", author: "Fajar", authorEmail: "fajar@example.com" }),
  commit({ hash: "cccc3333", subject: "chore: bump vite", refs: [{ type: "tag", name: "v2.0.1" }] }),
  commit({ hash: "dddd4444", subject: "WIP on main: cccc3333", refs: [{ type: "stash", name: "stash@{0}" }] }),
];

test("a token matches hash, subject, body, author and email, case-insensitively", () => {
  const want = [
    ["aa", ["aaaa1111"]],
    ["LANE", ["aaaa1111"]],
    ["max_lanes", ["aaaa1111"]],
    ["fajar@e", ["bbbb2222"]],
    ["stop", ["bbbb2222"]],
  ] as const;
  for (const [query, expected] of want) {
    assert.deepEqual(findMatches(rows, query), expected, `"${query}" selects one row`);
  }
});

test("ref pill names match too", () => {
  assert.deepEqual(findMatches(rows, "v2.0.1"), ["cccc3333"]);
  assert.deepEqual(findMatches(rows, "stash@{0}"), ["dddd4444"]);
});

test("several matches come back in list order", () => {
  assert.deepEqual(findMatches(rows, "cccc3333"), ["cccc3333", "dddd4444"]);
});

test("space-separated tokens AND together across fields", () => {
  assert.deepEqual(findMatches(rows, "fix flash"), ["bbbb2222"]);
  // Both tokens on one field is fine as well.
  assert.deepEqual(findMatches(rows, "lane cap"), ["aaaa1111"]);
  assert.deepEqual(findMatches(rows, "fix v2.0.1"), [], "no row carries both");
});

test("an empty or blank query matches nothing", () => {
  assert.deepEqual(findMatches(rows, ""), []);
  assert.deepEqual(findMatches(rows, "   "), []);
});

test("splitByTokens marks every token hit, case-insensitively, and escapes regex characters", () => {
  assert.deepEqual(splitByTokens("Fix the Flash fix", ["fix"]), [
    { text: "Fix", hit: true },
    { text: " the Flash ", hit: false },
    { text: "fix", hit: true },
  ]);
  assert.deepEqual(splitByTokens("stash@{0} (a+b)", ["stash@{0}", "a+b"]), [
    { text: "stash@{0}", hit: true },
    { text: " (", hit: false },
    { text: "a+b", hit: true },
    { text: ")", hit: false },
  ]);
  assert.deepEqual(splitByTokens("nothing", []), [{ text: "nothing", hit: false }]);
  assert.deepEqual(splitByTokens("nothing", ["zzz"]), [{ text: "nothing", hit: false }]);
});
