// The pure tree behind the file list's tree view: nesting, merging, ordering.
import assert from "node:assert/strict";
import { test } from "vitest";

import { buildFileTree } from "./fileTree";
import type { ChangedFile } from "../types";

const file = (path: string, additions = 1): ChangedFile => ({
  path,
  status: "modified",
  additions,
  deletions: 0,
  diff: [],
});

test("buildFileTree nests shared prefixes and merges same-named dirs", () => {
  const tree = buildFileTree([
    file("src/components/FileList.tsx"),
    file("src/components/DiffViewer.tsx"),
    file("src/lib/graph/deep.ts"),
    file("src/lib/ui.ts"),
    file("README.md"),
  ]);
  assert.equal(tree.name, "");
  assert.deepEqual(tree.dirs.map((d) => d.name), ["src"], "one node per top folder");
  assert.deepEqual(tree.files.map((f) => f.path), ["README.md"], "root files sit beside the top dirs");

  const src = tree.dirs[0];
  assert.deepEqual(src.dirs.map((d) => d.name), ["components", "lib"], "subfolders merge per prefix");
  const lib = src.dirs[1];
  assert.deepEqual(lib.dirs.map((d) => d.name), ["graph"], "nesting goes as deep as the paths do");
  assert.deepEqual(
    lib.dirs[0].files.map((f) => f.path),
    ["src/lib/graph/deep.ts"],
  );
  assert.deepEqual(
    src.dirs[0].files.map((f) => f.path),
    ["src/components/DiffViewer.tsx", "src/components/FileList.tsx"],
    "files sort alphabetically inside their folder",
  );
});

test("buildFileTree lists folders before files and sorts them alphabetically", () => {
  const tree = buildFileTree([file("zeta/a"), file("alpha/b"), file("mid/c"), file("root.ts")]);
  assert.deepEqual(tree.dirs.map((d) => d.name), ["alpha", "mid", "zeta"]);
  assert.deepEqual(tree.files.map((f) => f.path), ["root.ts"]);
});

test("buildFileTree keeps the ChangedFile objects themselves", () => {
  const readme = file("README.md", 3);
  const tree = buildFileTree([readme]);
  assert.equal(tree.files[0], readme, "identity is preserved so rows stay memoizable");
});
