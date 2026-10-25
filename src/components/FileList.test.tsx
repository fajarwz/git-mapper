// The changed-file sidebar: path splitting, selection, totals, collapse.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, render, fireEvent, within } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { FileList } from "./FileList";
import type { ChangedFile } from "../types";

afterEach(() => {
  cleanup();
});

const file = (path: string, status: ChangedFile["status"], additions = 1, deletions = 0): ChangedFile => ({
  path,
  status,
  additions,
  deletions,
  diff: [],
});

test("FileList splits dirs from names, sums counts and marks the selection", () => {
  const { container } = render(
    <FileList
      files={[file("src/app.tsx"), file("README.md", "added", 3, 0)]}
      selectedPath="README.md"
      onSelect={() => {}}
      collapsed={false}
      onToggleCollapse={() => {}}
    />,
  );
  assert.ok(within(container).getByText("2 files changed"));
  assert.ok(within(container).getByText("src/"), "the directory part renders separately");
  assert.ok(within(container).getByText("+4"), "additions sum across files");
  assert.equal(
    container.querySelectorAll('[data-file-item][data-selected="true"]').length,
    1,
    "exactly one row carries the selection",
  );
});

test("FileList collapses to only the header row", () => {
  const { container } = render(
    <FileList
      files={[file("src/app.tsx")]}
      selectedPath={null}
      onSelect={() => {}}
      collapsed
      onToggleCollapse={() => {}}
    />,
  );
  assert.equal(container.querySelectorAll("[data-file-item]").length, 0, "collapsed hides the rows");
  const toggle = container.querySelector("[aria-expanded]") as HTMLElement;
  assert.ok(toggle, "the collapse toggle is still reachable");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
});

test("FileList rows and the toggle wire their callbacks", () => {
  let picked: string | null = null;
  let toggled = 0;
  const { container } = render(
    <FileList
      files={[file("src/app.tsx")]}
      selectedPath={null}
      onSelect={(path) => {
        picked = path;
      }}
      collapsed={false}
      onToggleCollapse={() => {
        toggled += 1;
      }}
    />,
  );
  fireEvent.click(within(container).getByText("app.tsx"));
  assert.equal(picked, "src/app.tsx", "a click reports the full path, not the base name");
  fireEvent.click(container.querySelector("[aria-expanded]") as HTMLElement);
  assert.equal(toggled, 1);
});
