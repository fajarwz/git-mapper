// commitFilter behaviour: tokens, case folding, field coverage, identity on clear.
import assert from "node:assert/strict";
import { test } from "vitest";

import { filterCommits } from "./commitFilter";
import type { Commit } from "../types";

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
    ["aa", [rows[0]]],
    ["LANE", [rows[0]]],
    ["max_lanes", [rows[0]]],
    ["fajar@e", [rows[1]]],
    ["stop", [rows[1]]],
  ] as const;
  for (const [query, expected] of want) {
    assert.deepEqual(filterCommits(rows, query), expected, `"${query}" selects one row`);
  }
});

test("ref pill names match too", () => {
  assert.deepEqual(filterCommits(rows, "v2.0.1"), [rows[2]]);
  assert.deepEqual(filterCommits(rows, "stash@{0}"), [rows[3]]);
});

test("space-separated tokens AND together across fields", () => {
  assert.deepEqual(filterCommits(rows, "fix flash"), [rows[1]]);
  // Both tokens on one field is fine as well.
  assert.deepEqual(filterCommits(rows, "lane cap"), [rows[0]]);
  assert.deepEqual(filterCommits(rows, "fix v2.0.1"), [], "no row carries both");
});

test("an empty or blank query returns the input array itself", () => {
  assert.equal(filterCommits(rows, ""), rows, "no query means no filtering, same identity");
  assert.equal(filterCommits(rows, "   "), rows);
});
