// Dev-server mirror of src-tauri/src/git/merge.rs (browser tabs have no Tauri backend).
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
// @ts-expect-error type error without @types/node package
import path from "node:path";
import { type Handlers, run } from "./git.ts";

// Conflict helpers mirroring git/merge.rs. `git diff -- <path>` answers in git's
// combined `--cc` shape mid-conflict — no parser in this app speaks it, so the sides
// diff against the shared base via stage blobs (`:1:<path>` etc.).
export const mergingNow = (dir: string): boolean => {
  try {
    run(dir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    return true;
  } catch {
    return false;
  }
};
export const unmergedPaths = (dir: string): string[] => {
  const out = run(dir, ["status", "-sb"]);
  return out
    .split("\n")
    .filter((line) => {
      if (line.trim() === "" || line.startsWith("## ")) return false;
      const xy = line.slice(0, 2);
      return xy.includes("U") || xy === "AA" || xy === "DD";
    })
    .map((line) => line.slice(3).trimEnd());
};
export const stagePresence = (dir: string, p: string): [boolean, boolean, boolean] => {
  try {
    const seen = [false, false, false];
    for (const line of run(dir, ["ls-files", "-s", "-u", "--", p]).split("\n")) {
      const [meta] = line.split("\t");
      const stage = Number(meta?.trim().split(/\s+/)[2]);
      if (stage >= 1 && stage <= 3) seen[stage - 1] = true;
    }
    return [seen[0], seen[1], seen[2]];
  } catch {
    return [false, false, false];
  }
};

export const mergeHandlers: Handlers = {
  merge_branch: ({ dir, target }) => {
    try {
      run(String(dir), ["merge", "-q", "--no-edit", "--", String(target)]);
      return { merged: true, conflicts: [] };
    } catch (error) {
      const conflicts = unmergedPaths(String(dir));
      if (conflicts.length === 0) throw error;
      return { merged: false, conflicts };
    }
  },
  resolve_conflicts: ({ dir, paths, side }) => {
    const verb = String(side);
    if (verb !== "ours" && verb !== "theirs") {
      throw new Error(`${verb} is not a side of a conflict`);
    }
    const list = (paths as string[]) ?? [];
    if (list.length === 0) throw new Error("no path is selected");
    const dirPath = String(dir);
    for (const p of list) {
      const [, ours, theirs] = stagePresence(dirPath, String(p));
      const oursSide = verb === "ours";
      if (oursSide ? ours : theirs) {
        run(dirPath, ["checkout", "-q", oursSide ? "--ours" : "--theirs", "--", String(p)]);
        run(dirPath, ["add", "--", String(p)]);
      } else {
        run(dirPath, ["rm", "-q", "-f", "--", String(p)]);
      }
    }
    return null;
  },
  abort_merge: ({ dir }) => {
    const dirPath = String(dir);
    if (!mergingNow(dirPath)) {
      throw new Error("not in a merge — nothing to abort");
    }
    run(dirPath, ["merge", "--abort"]);
    return null;
  },
  complete_merge: ({ dir }) => {
    const dirPath = String(dir);
    if (!mergingNow(dirPath)) {
      throw new Error("not in a merge — nothing to complete");
    }
    const conflicts = unmergedPaths(dirPath);
    if (conflicts.length > 0) {
      throw new Error(`${conflicts[0]} is still unresolved — take a side or stage it first`);
    }
    run(dirPath, ["commit", "--no-edit", "-q"]);
    return null;
  },
  read_conflict_files: ({ dir, path: file }) => {
    const dirPath = String(dir);
    const p = String(file);
    const [base, ours, theirs] = stagePresence(dirPath, p);
    // Add/add conflicts have no base stage and git prints no patch for them; wrap the
    // content in the unified shape the parser reads.
    const addedPatch = (body: string): string => {
      const content = body.replace(/\r\n/g, "\n").replace(/\n$/, "");
      const lines = content === "" ? [] : content.split("\n");
      return [
        `diff --git a/${p} b/${p}`,
        "--- /dev/null",
        `+++ b/${p}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((line) => `+${line}`),
        "",
      ].join("\n");
    };
    const sidePatch = (stage: number, present: boolean): string => {
      if (!present) return "";
      try {
        return base
          ? run(dirPath, ["diff", "--no-color", `:1:${p}`, `:${stage}:${p}`])
          : addedPatch(run(dirPath, ["show", `:${stage}:${p}`]));
      } catch {
        return "";
      }
    };
    const worktreeText = (): string => {
      if (!(base || ours || theirs)) return "";
      try {
        return fs.readFileSync(path.join(dirPath, p), "utf8");
      } catch {
        return "";
      }
    };
    let incoming = "";
    try {
      const msgFile = String(run(dirPath, ["rev-parse", "--git-path", "MERGE_MSG"])).trim();
      const first = fs.readFileSync(path.resolve(dirPath, msgFile), "utf8").split(/\r?\n/)[0];
      incoming = /'([^']*)'/.exec(first)?.[1] ?? "";
      if (!incoming) incoming = String(run(dirPath, ["rev-parse", "--short", "MERGE_HEAD"])).trim();
    } catch {
      /* no merge message: the viewer falls back to "incoming" */
    }
    return {
      ours_patch: sidePatch(2, ours),
      theirs_patch: sidePatch(3, theirs),
      worktree_text: worktreeText(),
      incoming,
    };
  },
  write_conflict_resolution: ({ dir, path: file, content }) => {
    const dirPath = String(dir);
    const p = String(file);
    if (!unmergedPaths(dirPath).includes(p)) throw new Error(`${p} is not conflicted`);
    const text = String(content);
    fs.writeFileSync(path.join(dirPath, p), text);
    if (!/^(<<<<<<<|>>>>>>>)/m.test(text)) run(dirPath, ["add", "--", p]);
    return null;
  },
};
