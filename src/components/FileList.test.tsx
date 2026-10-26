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
      view="list"
      onViewChange={() => {}}
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
      view="list"
      onViewChange={() => {}}
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
      view="list"
      onViewChange={() => {}}
    />,
  );
  fireEvent.click(within(container).getByText("app.tsx"));
  assert.equal(picked, "src/app.tsx", "a click reports the full path, not the base name");
  fireEvent.click(container.querySelector("[aria-expanded]") as HTMLElement);
  assert.equal(toggled, 1);
});

test("FileList tree groups files under folder rows and still reports full paths", () => {
  let picked: string | null = null;
  const { container } = render(
    <FileList
      files={[file("src/components/FileList.tsx"), file("README.md", "added", 3, 0)]}
      selectedPath={null}
      onSelect={(path) => {
        picked = path;
      }}
      collapsed={false}
      onToggleCollapse={() => {}}
      view="tree"
      onViewChange={() => {}}
    />,
  );
  assert.equal(container.querySelectorAll("[data-file-dir]").length, 2, "one row per folder level: src/ and src/components/");
  assert.ok(within(container).getByText("src"), "the top folder row carries its segment");
  assert.ok(within(container).getByText("components"), "the nested folder row carries its segment");
  assert.ok(within(container).getByText("FileList.tsx"), "the tree row shows the base name");
  assert.ok(!within(container).queryByText("src/"), "no flat dir prefixes inside the tree");
  fireEvent.click(within(container).getByText("FileList.tsx"));
  assert.equal(picked, "src/components/FileList.tsx", "the tree row reports the full path");
});

test("FileList tree folders collapse and expand their children", () => {
  const { container } = render(
    <FileList
      files={[file("src/app.tsx"), file("src/lib/ui.ts")]}
      selectedPath={null}
      onSelect={() => {}}
      collapsed={false}
      onToggleCollapse={() => {}}
      view="tree"
      onViewChange={() => {}}
    />,
  );
  const dir = container.querySelector("[data-file-dir]") as HTMLElement;
  assert.equal(dir.getAttribute("aria-expanded"), "true", "folders start expanded");
  assert.equal(container.querySelectorAll("[data-file-item]").length, 2);
  fireEvent.click(dir);
  assert.equal(dir.getAttribute("aria-expanded"), "false");
  assert.equal(container.querySelectorAll("[data-file-item]").length, 0, "collapsed hides the files");
  fireEvent.click(dir);
  assert.equal(container.querySelectorAll("[data-file-item]").length, 2, "expanding brings them back");
});

test("FileList wires the list/tree toggle", () => {
  let view: string | null = null;
  const { container } = render(
    <FileList
      files={[file("src/app.tsx")]}
      selectedPath={null}
      onSelect={() => {}}
      collapsed={false}
      onToggleCollapse={() => {}}
      view="list"
      onViewChange={(next) => {
        view = next;
      }}
    />,
  );
  const treeButton = container.querySelector('[data-file-view="tree"]') as HTMLElement;
  assert.equal(treeButton.getAttribute("aria-pressed"), "false", "list is the active segment");
  fireEvent.click(treeButton);
  assert.equal(view, "tree", "picking Tree reports the new view");
});
