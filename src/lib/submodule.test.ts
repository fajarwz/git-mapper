import { describe, expect, it } from "vitest";
import type { DiffLine, Repository } from "../types";
import { parseCommitFiles } from "./gitDiffParser";
import { shapeSubmodules, submoduleParents, submodulePointer } from "./submodule";

const line = (type: DiffLine["type"], text: string): DiffLine => ({ type, text });
const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

describe("submodulePointer", () => {
  it("reads a bump from the real patch git prints for a gitlink", () => {
    const diff = [
      "diff --git a/vendor/inner b/vendor/inner",
      "index aaaaaaa..bbbbbbb 160000",
      "--- a/vendor/inner",
      "+++ b/vendor/inner",
      "@@ -1 +1 @@",
      `-Subproject commit ${OLD}`,
      `+Subproject commit ${NEW}-dirty`,
      "",
    ].join("\n");
    const [file] = parseCommitFiles({ numstat: "1\t1\tvendor/inner\n", name_status: "M\tvendor/inner\n", diff });
    expect(submodulePointer(file.diff)).toEqual({ from: OLD, to: NEW, dirty: true });
  });

  it("covers an added and a removed submodule", () => {
    expect(submodulePointer([line("hunk", "@@ -0,0 +1 @@"), line("add", `Subproject commit ${NEW}`)])).toEqual({
      from: null,
      to: NEW,
      dirty: false,
    });
    expect(submodulePointer([line("remove", `Subproject commit ${OLD}`)])).toEqual({
      from: OLD,
      to: null,
      dirty: false,
    });
  });

  it("leaves ordinary and unloaded patches alone", () => {
    expect(submodulePointer(null)).toBeNull();
    expect(submodulePointer([])).toBeNull();
    expect(submodulePointer([line("add", "const a = 1;")])).toBeNull();
    // A text file that merely quotes the line, next to other content, is not a gitlink.
    expect(
      submodulePointer([line("add", `Subproject commit ${NEW}`), line("add", "more text")]),
    ).toBeNull();
  });
});

describe("submodule shaping", () => {
  it("builds absolute paths and names, whatever slash the root ends with", () => {
    const [sub] = shapeSubmodules("C:/repo/", [{ path: "libs/api", state: "moved", commit: NEW }]);
    expect(sub).toMatchObject({ fullPath: "C:/repo/libs/api", name: "api", state: "moved" });
  });

  it("maps an open submodule back to its open parent", () => {
    const parent = { id: "C:/repo", submodules: shapeSubmodules("C:/repo", [{ path: "api", state: "ok", commit: NEW }]) };
    const child = { id: "C:/repo/api" };
    const parents = submoduleParents([parent, child] as Repository[]);
    expect(parents.get("C:/repo/api")).toBe("C:/repo");
    expect(parents.has("C:/repo")).toBe(false);
  });
});
