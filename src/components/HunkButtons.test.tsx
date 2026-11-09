// Per-hunk buttons on the uncommitted diff: which verbs each side offers, and the discard confirm.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { DiffViewer } from "./DiffViewer";
import type { ChangedFile } from "../types";

vi.mock("../data/gitLoader", () => ({ loadImageVersions: vi.fn() }));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const twoHunks: ChangedFile = {
  path: "a.txt",
  status: "modified",
  additions: 2,
  deletions: 0,
  diff: [
    { type: "hunk", text: "@@ -1,3 +1,4 @@" },
    { type: "add", text: "one" },
    { type: "hunk", text: "@@ -18,3 +19,4 @@" },
    { type: "add", text: "two" },
  ],
};

function show(side: "staged" | "unstaged", layout: "unified" | "split" = "unified") {
  const calls: unknown[][] = [];
  const view = render(
    <DiffViewer
      files={[twoHunks]}
      file={twoHunks}
      scope="file"
      onScopeChange={() => {}}
      layout={layout}
      scheme="app"
      hunkActions={{ side, onAction: (...args) => calls.push(args) }}
    />,
  );
  return { ...view, calls };
}

test("the unstaged side offers stage and discard per hunk, indexed in order", () => {
  const { container, calls } = show("unstaged");
  const stages = container.querySelectorAll('[data-hunk-action="stage"]');
  assert.equal(stages.length, 2);
  assert.equal(container.querySelectorAll('[data-hunk-action="unstage"]').length, 0);
  fireEvent.click(stages[1]);
  assert.deepEqual(calls, [["a.txt", 1, "@@ -18,3 +19,4 @@", "stage"]]);
  assert.equal(container.querySelector("[data-diff-side]")?.textContent, "Working tree");
});

test("the staged side offers only unstage", () => {
  const { container, calls } = show("staged");
  assert.equal(container.querySelectorAll('[data-hunk-action="stage"]').length, 0);
  assert.equal(container.querySelectorAll('[data-hunk-action="discard"]').length, 0);
  fireEvent.click(container.querySelectorAll('[data-hunk-action="unstage"]')[0]);
  assert.deepEqual(calls, [["a.txt", 0, "@@ -1,3 +1,4 @@", "unstage"]]);
  assert.equal(container.querySelector("[data-diff-side]")?.textContent, "Staged");
});

test("discard waits for the confirm dialog", () => {
  const { container, calls, getByText } = show("unstaged");
  fireEvent.click(container.querySelectorAll('[data-hunk-action="discard"]')[0]);
  assert.equal(calls.length, 0, "nothing runs before the dialog is answered");
  fireEvent.click(getByText("Discard hunk"));
  assert.deepEqual(calls, [["a.txt", 0, "@@ -1,3 +1,4 @@", "discard"]]);
});

test("split layout carries the same buttons, and a binary placeholder gets none", () => {
  const split = show("unstaged", "split");
  assert.equal(split.container.querySelectorAll('[data-hunk-action="stage"]').length, 2);
  cleanup();

  const binary: ChangedFile = { ...twoHunks, diff: [{ type: "hunk", text: "@@ Binary file, not shown @@" }] };
  const { container } = render(
    <DiffViewer
      files={[binary]}
      file={binary}
      scope="file"
      onScopeChange={() => {}}
      scheme="app"
      hunkActions={{ side: "unstaged", onAction: () => {} }}
    />,
  );
  assert.equal(container.querySelectorAll("[data-hunk-action]").length, 0);
});

test("without hunkActions a commit diff has no buttons", () => {
  const { container } = render(
    <DiffViewer files={[twoHunks]} file={twoHunks} scope="file" onScopeChange={() => {}} scheme="app" />,
  );
  assert.equal(container.querySelectorAll("[data-hunk-action]").length, 0);
});

const mixed: ChangedFile = {
  path: "m.txt",
  status: "modified",
  additions: 2,
  deletions: 1,
  diff: [
    { type: "hunk", text: "@@ -1,4 +1,5 @@" },
    { type: "context", text: "keep" },
    { type: "remove", text: "old" },
    { type: "add", text: "new" },
    { type: "add", text: "extra" },
    { type: "hunk", text: "@@ -20,2 +21,3 @@" },
    { type: "add", text: "later" },
  ],
};

function showLines(file: ChangedFile, side: "staged" | "unstaged", layout: "unified" | "split" = "unified") {
  const lineCalls: unknown[][] = [];
  const view = render(
    <DiffViewer
      files={[file]}
      file={file}
      scope="file"
      onScopeChange={() => {}}
      layout={layout}
      scheme="app"
      hunkActions={{ side, onAction: () => {}, onLines: (...args) => lineCalls.push(args) }}
    />,
  );
  return { ...view, lineCalls };
}

test("ticking lines turns the hunk buttons into line buttons, counted within the hunk", () => {
  const { container, lineCalls } = showLines(mixed, "unstaged");
  const picks = container.querySelectorAll("[data-line-pick]");
  assert.equal(picks.length, 4, "one tick box per changed line, none on context");
  // remove "old" is ordinal 0, add "extra" is ordinal 2; the context line has no tick box.
  fireEvent.mouseDown(container.querySelectorAll('[data-diff-line="remove"] [data-line-pick]')[0]);
  fireEvent.mouseDown(container.querySelectorAll('[data-diff-line="add"] [data-line-pick]')[1]);
  assert.equal(container.querySelectorAll("[data-line-picked]").length, 2);
  const stage = container.querySelector('[data-hunk-action="stage"]');
  assert.equal(stage?.textContent, "Stage +1 −1");
  assert.equal(container.querySelectorAll('[data-hunk-action="stage"]')[1]?.textContent, "Stage hunk");
  fireEvent.click(stage as Element);
  assert.deepEqual(lineCalls, [["m.txt", 0, "@@ -1,4 +1,5 @@", "stage", [0, 2]]]);
  assert.equal(container.querySelectorAll("[data-line-picked]").length, 0, "the ticks clear after acting");
});

test("picked lines can be cleared, discarded after a confirm, and unstaged on the staged side", () => {
  const first = showLines(mixed, "unstaged");
  fireEvent.mouseDown(first.container.querySelectorAll('[data-diff-line="add"] [data-line-pick]')[0]);
  fireEvent.click(first.container.querySelector('[data-hunk-action="clear"]') as Element);
  assert.equal(first.container.querySelectorAll("[data-line-picked]").length, 0);

  fireEvent.mouseDown(first.container.querySelectorAll('[data-diff-line="add"] [data-line-pick]')[1]);
  fireEvent.click(first.container.querySelector('[data-hunk-action="discard"]') as Element);
  assert.equal(first.lineCalls.length, 0, "no discard before the confirm");
  fireEvent.click(first.getByText("Discard lines"));
  assert.deepEqual(first.lineCalls, [["m.txt", 0, "@@ -1,4 +1,5 @@", "discard", [2]]]);
  cleanup();

  const staged = showLines(mixed, "staged");
  fireEvent.mouseDown(staged.container.querySelectorAll('[data-diff-line="remove"] [data-line-pick]')[0]);
  const unstage = staged.container.querySelector('[data-hunk-action="unstage"]');
  assert.equal(unstage?.textContent, "Unstage −1");
  fireEvent.click(unstage as Element);
  assert.deepEqual(staged.lineCalls, [["m.txt", 0, "@@ -1,4 +1,5 @@", "unstage", [0]]]);
});

test("split layout picks lines on both panes, and new or removed files offer no tick boxes", () => {
  const split = showLines(mixed, "unstaged", "split");
  // "old" (left) and "new" (right) of the first row are one change: either side ticks both.
  fireEvent.mouseDown(split.container.querySelectorAll('[data-diff-num="new"][data-line-pick]')[0]);
  assert.equal(split.container.querySelector('[data-hunk-action="stage"]')?.textContent, "Stage +1 −1");
  assert.equal(split.container.querySelectorAll("[data-line-picked]").length, 2);
  fireEvent.mouseDown(split.container.querySelectorAll('[data-diff-num="old"][data-line-pick]')[0]);
  assert.equal(split.container.querySelectorAll("[data-line-picked]").length, 0, "the other side unticks the pair");
  cleanup();

  const added = showLines({ ...mixed, status: "added" }, "unstaged");
  assert.equal(added.container.querySelectorAll("[data-line-pick]").length, 0);
  cleanup();

  const noLines = render(
    <DiffViewer files={[mixed]} file={mixed} scope="file" onScopeChange={() => {}} scheme="app"
      hunkActions={{ side: "unstaged", onAction: () => {} }} />,
  );
  assert.equal(noLines.container.querySelectorAll("[data-line-pick]").length, 0);
});

test("a pick is labelled by kind, so one replaced line reads +1 −1, not 2 lines", () => {
  const { container } = showLines(mixed, "unstaged");
  fireEvent.mouseDown(container.querySelectorAll('[data-diff-line="add"] [data-line-pick]')[0]);
  assert.equal(container.querySelector('[data-hunk-action="stage"]')?.textContent, "Stage +1");
  fireEvent.mouseDown(container.querySelectorAll('[data-diff-line="remove"] [data-line-pick]')[0]);
  assert.equal(container.querySelector('[data-hunk-action="stage"]')?.textContent, "Stage +1 −1");
  assert.equal(container.querySelector('[data-hunk-action="discard"]')?.textContent, "Discard +1 −1");
});

test("Shift-click picks the range between two lines, and dragging across gutters picks along", () => {
  const { container, lineCalls } = showLines(mixed, "unstaged");
  const pick = (kind: string, n: number) =>
    container.querySelectorAll(`[data-diff-line="${kind}"] [data-line-pick]`)[n] as Element;
  fireEvent.mouseDown(pick("remove", 0));
  fireEvent.mouseUp(window);
  fireEvent.mouseDown(pick("add", 1), { shiftKey: true });
  assert.equal(container.querySelectorAll("[data-line-picked]").length, 3, "old, new and extra");
  fireEvent.click(container.querySelector('[data-hunk-action="clear"]') as Element);

  fireEvent.mouseDown(pick("add", 0));
  fireEvent.mouseEnter(pick("add", 1));
  fireEvent.mouseUp(window);
  fireEvent.mouseEnter(pick("remove", 0));
  assert.equal(container.querySelectorAll("[data-line-picked]").length, 2, "the drag ended with the mouse button");
  fireEvent.click(container.querySelector('[data-hunk-action="stage"]') as Element);
  assert.deepEqual(lineCalls, [["m.txt", 0, "@@ -1,4 +1,5 @@", "stage", [1, 2]]]);
});

test("picks survive a reload that leaves the hunk alone, and drop when the hunk changes", () => {
  const view = (file: ChangedFile) => (
    <DiffViewer
      files={[file]}
      file={file}
      scope="file"
      onScopeChange={() => {}}
      scheme="app"
      hunkActions={{ side: "unstaged", onAction: () => {}, onLines: () => {} }}
    />
  );
  const { container, rerender } = render(view(mixed));
  fireEvent.mouseDown(container.querySelectorAll('[data-diff-line="add"] [data-line-pick]')[0]);
  rerender(view({ ...mixed, diff: [...(mixed.diff ?? [])] }));
  assert.equal(container.querySelectorAll("[data-line-picked]").length, 1, "same hunk text: kept");

  const edited = (mixed.diff ?? []).map((line) => (line.text === "new" ? { ...line, text: "newer" } : line));
  rerender(view({ ...mixed, diff: edited }));
  assert.equal(container.querySelectorAll("[data-line-picked]").length, 0, "hunk changed: dropped");
});

test("hover hints say how to pick, or why a new file only takes whole hunks", () => {
  const picking = showLines(mixed, "unstaged");
  assert.match(picking.container.textContent ?? "", /pick lines/);
  fireEvent.mouseDown(picking.container.querySelectorAll('[data-diff-line="add"] [data-line-pick]')[0]);
  assert.doesNotMatch(
    picking.container.querySelectorAll('[data-diff-line="hunk"]')[0].textContent ?? "",
    /pick lines/,
    "no hint once lines are picked in that hunk",
  );
  cleanup();
  const added = showLines({ ...mixed, status: "added" }, "unstaged");
  assert.match(added.container.textContent ?? "", /exists on both sides/);
});

test("only a hunk's first changed line is a tab stop; arrows walk, Escape clears the hunk", () => {
  const { container } = showLines(mixed, "unstaged");
  const boxes = [...container.querySelectorAll<HTMLElement>("[data-line-pick]")];
  assert.deepEqual(boxes.map((box) => box.tabIndex), [0, -1, -1, 0]);
  assert.equal(boxes[0].getAttribute("aria-label"), "Pick removed line 2");
  boxes[0].focus();
  fireEvent.keyDown(boxes[0], { key: "ArrowDown" });
  assert.equal(document.activeElement, boxes[1]);
  fireEvent.keyDown(boxes[1], { key: " " });
  assert.equal(container.querySelectorAll("[data-line-picked]").length, 1);
  fireEvent.keyDown(boxes[1], { key: "Escape" });
  assert.equal(container.querySelectorAll("[data-line-picked]").length, 0);
});
