// The conflict view: the file with its markers as one inline view, a choice on each block
// that rewrites that block, and a whole-file fallback when there is no text to edit.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { ConflictViewer } from "./ConflictViewer";
import type { ConflictSnapshot } from "../data/gitLoader";

afterEach(() => {
  cleanup();
});

const PATCH = "diff --git a/p b/p\n--- a/p\n+++ b/p\n@@ -1 +1 @@\n-base\n+x\n";
const TEXT =
  'const palette = {\n<<<<<<< HEAD\n  primary: "#22a88d",\n=======\n  primary: "#e2557a",\n>>>>>>> feature/colors\n  ink: "#1a1a22",\n};\n';

const SNAPSHOT: ConflictSnapshot = {
  oursPatch: PATCH,
  theirsPatch: PATCH,
  worktreeText: TEXT,
  incoming: "feature/colors",
};

function renderView(snapshot: ConflictSnapshot = SNAPSHOT) {
  const writes: string[] = [];
  const sides: string[] = [];
  const { container } = render(
    <ConflictViewer
      conflict={{ path: "palette.txt", snapshot }}
      currentBranch="main"
      onResolve={(side) => sides.push(side)}
      onWriteText={async (text) => {
        writes.push(text);
      }}
    />,
  );
  return { container, writes, sides };
}

test("both sides read inline, named by branch, with a button that says what it keeps", () => {
  const { container } = renderView();
  const view = within(container);
  assert.ok(view.getByText('primary: "#22a88d",'));
  assert.ok(view.getByText('primary: "#e2557a",'));
  assert.ok(view.getByText("1 conflict left — choose what to keep for each."));
  assert.ok(view.getByRole("button", { name: "Keep current" }));
  assert.ok(view.getByRole("button", { name: "Keep incoming" }));
  assert.ok(view.getByRole("button", { name: "Keep both" }));
});

test("a choice sends the file with only that block replaced", async () => {
  const wrap = renderView();
  fireEvent.click(within(wrap.container).getByRole("button", { name: "Keep incoming" }));
  await waitFor(() => assert.equal(wrap.writes.length, 1));
  assert.equal(
    wrap.writes[0],
    'const palette = {\n  primary: "#e2557a",\n  ink: "#1a1a22",\n};\n',
  );

  fireEvent.click(within(wrap.container).getByRole("button", { name: "Keep both" }));
  await waitFor(() => assert.equal(wrap.writes.length, 2));
  assert.ok(
    wrap.writes[1].includes('"#22a88d",\n  primary: "#e2557a",'),
    "current's lines first, then incoming's",
  );
});

test("a deleted side falls back to a whole-file choice that says who deleted it", () => {
  const wrap = renderView({
    oursPatch: PATCH,
    theirsPatch: "",
    worktreeText: "kept\n",
    incoming: "feature/colors",
  });
  const view = within(wrap.container);
  assert.ok(
    view.getByText(
      /The incoming branch \(feature\/colors\) deleted this file, while the current branch \(main\) changed it/,
    ),
  );
  fireEvent.click(view.getByRole("button", { name: "Keep current version" }));
  fireEvent.click(view.getByRole("button", { name: "Accept the deletion (incoming)" }));
  assert.deepEqual(wrap.sides, ["ours", "theirs"]);

  cleanup();
  const ours = renderView({
    oursPatch: "",
    theirsPatch: PATCH,
    worktreeText: "",
    incoming: "feature/colors",
  });
  assert.ok(
    within(ours.container).getByText(
      /The current branch \(main\) deleted this file, while the incoming branch \(feature\/colors\) changed it/,
    ),
  );
  assert.ok(within(ours.container).getByRole("button", { name: "Keep it deleted (current)" }));
});

test("every code row carries its line number from the file on disk, markers counted", () => {
  const { container } = renderView();
  const numbers = [...container.querySelectorAll("[data-line-number]")].map((n) => n.textContent);
  // 2 and 4 and 6 are the marker lines; the bands stand in for them.
  assert.deepEqual(numbers, ["1", "3", "5", "7", "8"]);
});

test("a deleted side still shows what the other side changed, numbered like the diff pane", () => {
  const patch =
    "diff --git a/palette.txt b/palette.txt\n--- a/palette.txt\n+++ b/palette.txt\n@@ -4 +4 @@\n-base line\n+kept change\n";
  const wrap = renderView({
    oursPatch: patch,
    theirsPatch: "",
    worktreeText: "kept change\n",
    incoming: "feature/colors",
  });
  const view = within(wrap.container);
  assert.ok(view.getByText(/changed this file — keeping the deletion drops these changes/));
  assert.ok(view.getByText("base line"));
  assert.ok(view.getByText("kept change"));
  const removed = wrap.container.querySelector("[data-patch-line='remove']");
  const added = wrap.container.querySelector("[data-patch-line='add']");
  assert.equal(removed?.firstElementChild?.textContent, "4");
  assert.equal(added?.children[1]?.textContent, "4");
});

test("previous/next walk the conflict blocks and say where you are", () => {
  const second = "<<<<<<< HEAD\nlate a\n=======\nlate b\n>>>>>>> feature/colors\n";
  const scrolled: Element[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    scrolled.push(this);
  };
  try {
    const wrap = renderView({ ...SNAPSHOT, worktreeText: `${TEXT}x\ny\nz\n${second}` });
    const view = within(wrap.container);
    const position = () => wrap.container.querySelector("[data-conflict-position]")?.textContent;
    assert.equal(position(), "Conflict 1 of 2");
    assert.equal((view.getByRole("button", { name: "Previous conflict" }) as HTMLButtonElement).disabled, true);

    fireEvent.click(view.getByRole("button", { name: "Next conflict" }));
    assert.equal(position(), "Conflict 2 of 2");
    const blocks = wrap.container.querySelectorAll("[data-conflict-block]");
    assert.equal(scrolled[0], blocks[1], "the second block is scrolled into view");
    assert.equal((view.getByRole("button", { name: "Next conflict" }) as HTMLButtonElement).disabled, true);

    fireEvent.click(view.getByRole("button", { name: "Previous conflict" }));
    assert.equal(position(), "Conflict 1 of 2");
    assert.equal(scrolled[1], blocks[0]);
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});
