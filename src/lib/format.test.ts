// Small pure helpers: date formatting, status letters, diff line numbers.
import assert from "node:assert/strict";
import { test } from "vitest";

import { formatAbsoluteDate, numberDiffLines, statusLetter, STATUS_LABELS } from "./format";

// The formatter pins the locale, so the assertion does not move with the test machine.
test("absolute dates are printed in en-GB shape, never relative", () => {
  assert.equal(formatAbsoluteDate("2026-10-25T12:09:00+07:00"), "25 Oct 2026 12:09");
  assert.equal(
    formatAbsoluteDate("2026-01-04T03:00:00+07:00"),
    "4 Jan 2026 03:00",
    "no zero-padded day, zero-padded hour",
  );
});

test("status letters and labels agree with the four-way status model", () => {
  assert.equal(statusLetter("added"), "A");
  assert.equal(statusLetter("modified"), "M");
  assert.equal(statusLetter("deleted"), "D");
  assert.equal(statusLetter("renamed"), "R");
  assert.deepEqual(Object.keys(STATUS_LABELS), ["added", "modified", "deleted", "renamed"]);
});

test("gutter numbers restart at each hunk; adds move the new column, removes the old", () => {
  const numbered = numberDiffLines([
    { type: "hunk", text: "@@ -3,2 +4,2 @@" },
    { type: "context", text: "kept" },
    { type: "add", text: "came" },
    { type: "remove", text: "gone" },
    { type: "add", text: "second" },
    { type: "context", text: "after" },
  ]);
  assert.deepEqual(
    numbered.map((l) => [l.type, l.text, l.oldNumber ?? "", l.newNumber ?? ""]),
    [
      ["hunk", "@@ -3,2 +4,2 @@", "", ""],
      ["context", "kept", 3, 4],
      ["add", "came", "", 5],
      ["remove", "gone", 4, ""],
      ["add", "second", "", 6],
      ["context", "after", 5, 7],
    ],
    "the hunk sets the counters, a context line takes the pair first and then advances both",
  );
});

test("a hunk header that does not parse leaves the counters alone", () => {
  const numbered = numberDiffLines([
    { type: "hunk", text: "@@ Binary file, not shown @@" },
    { type: "add", text: "whatever" },
  ]);
  assert.deepEqual(
    numbered.map((l) => [l.text, l.newNumber]),
    [["@@ Binary file, not shown @@", undefined], ["whatever", 0]],
    "counter 0 is still numberable — only a missing counter is undefined",
  );
});
