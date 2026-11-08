// Dev-server mirror of src-tauri/src/git/hunks.rs (browser tabs have no Tauri backend).
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
// @ts-expect-error type error without @types/node package
import path from "node:path";
// @ts-expect-error type error without @types/node package
import { execFileSync } from "node:child_process";
import { type Handlers, run } from "./git.ts";
import { untrackedEntry } from "./files.ts";

export const hunksHandlers: Handlers = {
  // Mirrors read_wip_side_in (src-tauri/src/git/hunks.rs): one side of the uncommitted changes.
  read_wip_side: ({ dir, side }) => {
    const cwd = String(dir);
    if (side !== "staged" && side !== "unstaged") throw new Error(`unknown side: ${String(side)}`);
    const cached = side === "staged" ? ["--cached"] : [];
    const safe = (args: string[]) => {
      try {
        return run(cwd, args);
      } catch {
        return "";
      }
    };
    let numstat = safe(["diff", "--numstat", "--no-color", ...cached]);
    let name_status = safe(["diff", "--name-status", "--no-color", ...cached]);
    let diff = safe(["diff", "-U3", "--no-color", ...cached]);
    if (side === "unstaged") {
      for (const file of safe(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")) {
        if (!file) continue;
        const entry = untrackedEntry(cwd, file);
        numstat += entry.numstat;
        name_status += entry.nameStatus;
        diff += entry.patch;
      }
    }
    return { numstat, name_status, diff };
  },
  // Mirrors apply_hunk_in: rebuild the patch from a fresh diff, refuse a hunk that moved.
  apply_hunk: ({ dir, path: filePath, side, hunkIndex, hunkHeader, action }) => {
    const cwd = String(dir);
    const file = String(filePath);
    const flags: Record<string, string[] | undefined> = {
      "stage:unstaged": ["--cached"],
      "discard:unstaged": ["--reverse"],
      "unstage:staged": ["--cached", "--reverse"],
    };
    const applyFlags = flags[`${String(action)}:${String(side)}`];
    if (!applyFlags) throw new Error(`cannot ${String(action)} a hunk of the ${String(side)} diff`);
    const staged = side === "staged";
    if (!staged) {
      const untracked = run(cwd, ["ls-files", "--others", "--exclude-standard", "--", file]).trim();
      if (untracked) {
        if (action === "stage") run(cwd, ["add", "--", file]);
        else fs.rmSync(path.join(cwd, file), { force: true });
        return null;
      }
    }
    const diff = run(cwd, ["diff", "--no-color", "--no-renames", "-U3", ...(staged ? ["--cached"] : []), "--", file]);
    const at = diff.search(/^@@ /m);
    const hunks = at === -1 ? [] : diff.slice(at).split(/^(?=@@ )/m);
    const hunk = hunks[Number(hunkIndex)];
    if (hunk === undefined) throw new Error("that hunk is gone — the file changed, refresh and try again");
    if (hunk.split("\n")[0].replace(/\r$/, "") !== String(hunkHeader)) {
      throw new Error("that hunk changed since it was shown — refresh and try again");
    }
    execFileSync("git", ["apply", "--recount", "--whitespace=nowarn", ...applyFlags, "-"], {
      cwd,
      input: diff.slice(0, at) + hunk,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return null;
  },
};
