// shapeWorktreeFiles: raw reader entries become the panel's rows — index rows first,
// alphabetical inside a section, snake_case old paths folded into the UI shape.
import assert from "node:assert/strict";
import { test } from "vitest";

import { shapeWorktreeFiles, type WorktreeEntryRaw } from "./staging";

const raw = (over: Partial<WorktreeEntryRaw>): WorktreeEntryRaw => ({
  key: "worktree:x",
  path: "x",
  status: "modified",
  staged: false,
  untracked: false,
  additions: 1,
  deletions: 0,
  ...over,
});

test("index rows lead and each section is alphabetical", () => {
  const rows = shapeWorktreeFiles([
    raw({ key: "worktree:z.ts", path: "z.ts" }),
    raw({ key: "index:app.ts", path: "app.ts", staged: true, additions: 3 }),
    raw({ key: "worktree:a.ts", path: "a.ts" }),
    raw({ key: "index:bee.ts", path: "bee.ts", staged: true }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.key),
    ["index:app.ts", "index:bee.ts", "worktree:a.ts", "worktree:z.ts"],
  );
});

test("the raw shape maps to the panel row: old path folding, untracked flag, empty diffs", () => {
  const rows = shapeWorktreeFiles([
    raw({
      key: "worktree:moved.tsx",
      path: "moved.tsx",
      old_path: "src/old.tsx",
      status: "renamed",
      untracked: false,
    }),
    raw({ key: "worktree:new.txt", path: "new.txt", status: "added", untracked: true }),
  ]);
  assert.equal(rows[0].oldPath, "src/old.tsx");
  assert.equal(rows[0].untracked, false);
  assert.equal(rows[0].diff?.length, 0, "rows carry no patches; the diff pane loads its own");
  assert.equal(rows[1].untracked, true, "untracked rows delete their file on discard");
});
