// The conflict panes: both sides stack, a side with no stage renders absent, and the
// resolve buttons send their side — the decision the rail acts on.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { ConflictViewer } from "./ConflictViewer";
import type { ConflictSnapshot } from "../data/gitLoader";

afterEach(() => {
  cleanup();
});

const SNAPSHOT: ConflictSnapshot = {
  oursPatch:
    "diff --git a/rel.txt b/rel.txt\n--- a/rel.txt\n+++ b/rel.txt\n@@ -1 +1 @@\n-base\n+ours\n",
  theirsPatch:
    "diff --git a/rel.txt b/rel.txt\n--- a/rel.txt\n+++ b/rel.txt\n@@ -1 +1 @@\n-base\n+theirs\n",
};

function renderView(snapshot: ConflictSnapshot = SNAPSHOT) {
  const sides: string[] = [];
  const { container } = render(
    <ConflictViewer conflict={{ path: "rel.txt", snapshot }} onResolve={(s) => sides.push(s)} />,
  );
  return { container, sides: () => sides };
}

test("both sides stack with their resolve buttons", () => {
  const wrap = renderView();
  assert.ok(within(wrap.container).getAllByText("rel.txt").length >= 1);
  assert.ok(within(wrap.container).getByText("Ours (HEAD)"));
  assert.ok(within(wrap.container).getByText("Theirs (MERGE_HEAD)"));

  fireEvent.click(within(wrap.container).getByText("Take ours"));
  fireEvent.click(within(wrap.container).getByText("Take theirs"));
  assert.deepEqual(wrap.sides(), ["ours", "theirs"]);

  // The patches parse into rows: each side shows base removed, its own edit added.
  const rows = within(wrap.container).getAllByText(/^(base|ours|theirs)$/);
  assert.ok(rows.length >= 4, "the minus and plus rows of both patches render");
});

test("an absent side says so instead of showing a body", () => {
  const wrap = renderView({
    path: "rel.txt",
    snapshot: { oursPatch: "", theirsPatch: SNAPSHOT.theirsPatch },
  });
  assert.ok(within(wrap.container).getByText(/our side had deleted it/));
  // The absent side's button still resolves — to the deletion git's index keeps.
  fireEvent.click(within(wrap.container).getByText("Take ours"));
  assert.deepEqual(wrap.sides(), ["ours"]);
});
