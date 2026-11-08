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
