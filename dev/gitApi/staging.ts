// Dev-server mirror of src-tauri/src/git/staging.rs (browser tabs have no Tauri backend).
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
// @ts-expect-error type error without @types/node package
import path from "node:path";
import { type Handlers, run } from "./git.ts";
import { eachStatusV2, stagedRenames, statusRaw } from "./status.ts";

export const stagingHandlers: Handlers = {
  stage_files: ({ dir, paths }) => {
    const list = (paths as string[]) ?? [];
    if (list.length === 0) return null;
    run(String(dir), ["add", "--", ...list]);
    return null;
  },
  unstage_files: ({ dir, paths }) => {
    const list = (paths as string[]) ?? [];
    if (list.length === 0) return null;
    run(String(dir), ["restore", "--staged", "--", ...list]);
    // A staged rename is delete-source + add-destination in the index: restore both, and
    // walk the file back to the source's name so the rename vanishes cleanly.
    const renames = stagedRenames(dir).filter(([dest]) => list.includes(dest));
    for (const [dest, source] of renames) {
      run(String(dir), ["restore", "--staged", "--", source]);
      try {
        fs.renameSync(path.join(String(dir), dest), path.join(String(dir), source));
      } catch {
        // A partial move is still better than leaving a phantom deletion behind.
      }
    }
    return null;
  },
  discard_files: ({ dir, paths }) => {
    const dirPath = String(dir);
    const wanted = new Set((paths as string[]) ?? []);
    if (wanted.size === 0) return null;
    // Classification mirrors git.rs: untracked → clean -f, index-changed → worktree from
    // index, tracked → checkout -f HEAD, intent-to-add → delete from disk. Empty groups
    // NEVER run: `checkout -f HEAD --` without paths resets the whole tree.
    const cleanPaths: string[] = [];
    const fromIndex: string[] = [];
    const fromHead: string[] = [];
    const fromDisk: string[] = [];
    // `ls-tree -r` walks the whole tree: without -r the set holds only top-level names and
    // any nested modified path fell into the delete-from-disk branch (the discard-file bug).
    const headSet = new Set(
      run(dirPath, ["ls-tree", "-r", "--name-only", "-z", "HEAD"]).split("\0").filter(Boolean),
    );
    eachStatusV2(statusRaw(dirPath), (x, y, entryPath) => {
      if (!wanted.has(entryPath)) return;
      if (y === "?") cleanPaths.push(entryPath);
      else if (x !== ".") fromIndex.push(entryPath);
      else if (headSet.has(entryPath)) fromHead.push(entryPath);
      else fromDisk.push(entryPath);
    });
    if (cleanPaths.length > 0) run(dirPath, ["clean", "-qf", "--", ...cleanPaths]);
    if (fromIndex.length > 0) run(dirPath, ["checkout", "--", ...fromIndex]);
    if (fromHead.length > 0) run(dirPath, ["checkout", "-f", "HEAD", "--", ...fromHead]);
    for (const p of fromDisk) fs.rmSync(path.join(dirPath, p), { force: true });
    return null;
  },
  discard_all: ({ dir }) => {
    const dirPath = String(dir);
    try {
      run(dirPath, ["rev-parse", "--verify", "HEAD"]);
      run(dirPath, ["reset", "--hard", "-q"]);
    } catch {
      // Unborn branch: only the clean applies.
    }
    run(dirPath, ["clean", "-qfd"]);
    return null;
  },
  commit_staged: ({ dir, message }) => {
    const dirPath = String(dir);
    const msg = String(message ?? "").trim();
    if (msg === "") throw new Error("the commit message is empty");
    const staged = run(dirPath, ["diff", "--cached", "--name-only", "-z"]);
    if (!staged.includes("\0") && staged.trim() === "") {
      throw new Error("nothing is staged to commit");
    }
    run(dirPath, ["commit", "-q", "-m", msg]);
    return null;
  },
  // The rail's commit in reverse: the tip's tree returns to the index (staged). Same guards
  // as git.rs's undo_commit_in — root and merge tips are refused, not half-explained.
  undo_commit: ({ dir }) => {
    const dirPath = String(dir);
    const parentCount = run(dirPath, ["rev-list", "--parents", "-1", "HEAD"]).trim().split(/\s+/).length - 1;
    if (parentCount <= 0) {
      throw new Error("the tip is the repository's root commit — there is nothing to undo onto");
    }
    if (parentCount > 1) {
      throw new Error("the tip is a merge commit — its undo is not a soft reset");
    }
    run(dirPath, ["reset", "--soft", "HEAD~1"]);
    return null;
  },
};
