// Parser coverage: numstat / name-status / patch in, ChangedFile list out.
// The raw payloads mirror what src-tauri/src/git.rs read_commit_files returns
// (+ its untracked_entry appendons for the wip pseudo-commit).
import assert from "node:assert/strict";
import { test } from "vitest";

import { parseCommitFiles, parseDiffSections } from "./gitDiffParser";
import { parseLog, parseRefs } from "./gitLogParser";

const T = (type, text) => ({ type, text });

test("name-status letters become statuses, renames carry the live path", () => {
  const files = parseCommitFiles({
    numstat: "",
    name_status: [
      "M\tsrc/app.ts",
      "A\tsrc/new.ts",
      "D\tsrc/gone.ts",
      "R100\told/here.ts\tnew/there.ts",
      "T\tsrc/link.ps1",
      "U\tsrc/unknown.ts",
    ].join("\n"),
    diff: "",
  });
  assert.deepEqual(
    files.map((f) => [f.path, f.status]),
    [
      ["src/app.ts", "modified"],
      ["src/new.ts", "added"],
      ["src/gone.ts", "deleted"],
      ["new/there.ts", "renamed"],
      ["src/link.ps1", "modified"],
    ],
    "T is a typechange (rendered as modified); U does not map, so the entry is dropped",
  );
  assert.equal(files[3].oldPath, "old/here.ts", "the rename keeps its source path");
  assert.equal(files[3].renameScore, 100);
  assert.equal(files[0].oldPath, undefined, "plain changes have no old path");
});

test("numstat counts land on the renamed live path; binary counts stay zero", () => {
  const files = parseCommitFiles({
    numstat: [
      "12\t3\tsrc/app.ts",
      "8\t0\tsrc/{old-here.ts => new-there.ts}",
      "-\t-\tassets/logo.png",
    ].join("\n"),
    name_status: ["M\tsrc/app.ts", "R100\tsrc/old-here.ts\tsrc/new-there.ts", "M\tassets/logo.png"].join("\n"),
    diff: "",
  });
  assert.deepEqual(
    [
      [files[0].path, files[0].additions, files[0].deletions],
      [files[1].path, files[1].additions, files[1].deletions],
      [files[2].path, files[2].additions, files[2].deletions],
    ],
    [
      ["src/app.ts", 12, 3],
      ["src/new-there.ts", 8, 0],
      ["assets/logo.png", 0, 0],
    ],
    "numstat prints renames as dir/{old => new}; '-' (binary) means no countable change",
  );
});

test("a cross-directory rename joins numstat's brace path with name-status's live path", () => {
  const files = parseCommitFiles({
    numstat: "6\t1\t{a/one.ts => b/two.ts}\n",
    name_status: "R100\ta/one.ts\tb/two.ts\n",
    diff: "",
  });
  assert.deepEqual(
    [files[0].path, files[0].additions, files[0].deletions],
    ["b/two.ts", 6, 1],
    "the whole prefix can sit in the braces; name-status decides the display path",
  );
});

test("patch sections group per file, keyed by the b-side (or a-side for deletions)", () => {
  const diff = [
    "diff --git a/one.ts b/one.ts",
    "index 111..222 100644",
    "--- a/one.ts",
    "+++ b/one.ts",
    "@@ -1,2 +1,3 @@",
    " line kept",
    "-line gone",
    "+line came",
    "",
    "\\ No newline at end of file",
    "diff --git a/deleted.ts b/deleted.ts",
    "deleted file mode 100644",
    "--- a/deleted.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-once",
  ].join("\n");
  const sections = parseDiffSections(diff);

  const one = sections.get("one.ts");
  assert.ok(one, "sections key on the patch's b/path");
  assert.deepEqual(one[0], T("hunk", "@@ -1,2 +1,3 @@"));
  assert.deepEqual(one[1], T("context", "line kept"), "the renderer adds prefixes back, so text is bare");
  assert.deepEqual(one[2], T("remove", "line gone"));
  assert.deepEqual(one[3], T("add", "line came"));
  assert.deepEqual(one[4], T("context", ""), "a blank content line survives as context");
  assert.equal(one.length, 5, '"\\ No newline" is not a content line');

  const deleted = sections.get("deleted.ts");
  assert.ok(deleted, "with +++ /dev/null the a-side keys the section");
  assert.deepEqual(deleted[0], T("hunk", "@@ -1 +0,0 @@"));
  assert.deepEqual(deleted[1], T("remove", "once"));
});

test("the fake binary hunk for untracked files still renders something", () => {
  // src-tauri/src/git.rs untracked_entry prints this when a new file is unreadable/binary.
  const diff = "diff --git a/logo.png b/logo.png\nnew file mode 100644\n--- /dev/null\n+++ b/logo.png\n@@ Binary file, not shown @@\n";
  const sections = parseDiffSections(diff);
  assert.deepEqual(sections.get("logo.png"), [
    T("hunk", "@@ Binary file, not shown @@"),
    T("context", ""),
  ], "the patch's trailing newline reads as one blank context line");
});

test("parseLog keeps multi-line bodies, real parents and the branch pill", () => {
  const RS = String.fromCharCode(30);
  const record = (deco, hash, parents, body) =>
    [deco, hash, "Fajar", "fajar@example.com", "2026-10-25T10:00:00+07:00", parents, body].join("\0") + RS + "\n";
  const raw =
    record("(HEAD -> main)", "m1", "base", "subject line\n\nbody paragraph\nfootnote\n") +
    record("", "base", "", "root");

  const commits = parseLog(raw);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].subject, "subject line");
  assert.equal(commits[0].body, "body paragraph\nfootnote", "only the subject is split off");
  assert.deepEqual(commits[0].parents, ["base"]);
  assert.deepEqual(commits[1].parents, [], "a root has no parents");
  assert.deepEqual(
    commits[0].refs.map((r) => `${r.type}:${r.name}:${r.isCurrent ? "yes" : "no"}`),
    ["branch:main:yes"],
  );
});

test("slashed decoration entries are dropped; for-each-ref supplies those branches", () => {
  // The decoration parser filters anything with a slash that is not a namespace
  // indicator it understands — fix/x comes back as a proper tip pill via mergeRefs.
  const refs = parseRefs("(HEAD -> main, tag: v2, fix/jersium)");
  assert.deepEqual(
    refs.map((r) => `${r.type}:${r.name}`),
    ["branch:main", "tag:v2"],
  );
});
