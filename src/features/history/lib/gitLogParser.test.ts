// Log/stash record parsing: one entry per git record, newest first, plumbing skipped.
import assert from "node:assert/strict";
import { test } from "vitest";

import { parseStashes } from "./gitLogParser";

const NUL = String.fromCharCode(0);
const RS = String.fromCharCode(30);

/** One `read_stashes` record, shaped the way git prints it (record + newline). */
const stashRecord = (selector, hash, parents, date, message) =>
  [selector, hash, parents, "fajarwz", "fajar@example.com", date, message].join(NUL) + RS + "\n";

test("stash records parse into one entry each, newest first", () => {
  const raw =
    stashRecord(
      "stash@{0}",
      "aaa111",
      "base1 index1 untracked1",
      "2026-10-25T11:03:15+07:00",
      "WIP on main: base1 feat: one",
    ) +
    stashRecord(
      "stash@{1}",
      "bbb222",
      "base1 index2",
      "2026-10-25T10:50:13+07:00",
      "WIP on main: base1 feat: one",
    );

  const stashes = parseStashes(raw);
  assert.equal(stashes.length, 2);
  assert.deepEqual(
    stashes.map((stash) => stash.selector),
    ["stash@{0}", "stash@{1}"],
    "the newest entry leads, as git lists it, and the selector is not polluted by the record newline",
  );
  assert.deepEqual(
    stashes[0].parents,
    ["base1", "index1", "untracked1"],
    "git's parents are kept: the loader shows only the first",
  );
  assert.equal(stashes[1].hash, "bbb222");
  assert.equal(stashes[1].date, "2026-10-25T10:50:13+07:00");
  assert.equal(parseStashes("").length, 0);
  assert.equal(parseStashes(RS).length, 0, "an empty list is not one blank entry");
  assert.equal(parseStashes(`stash@{0}${NUL}only-a-hash${RS}`).length, 0, "a short record is skipped");
});
