// Dev-server mirror of src-tauri/src/git/hunks.rs (browser tabs have no Tauri backend).
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
// @ts-expect-error type error without @types/node package
import path from "node:path";
// @ts-expect-error type error without @types/node package
import { execFileSync } from "node:child_process";
import { type Handlers, run } from "./git.ts";
import { untrackedEntry } from "./files.ts";

// Mirrors trim_hunk: `selected` counts only +/- lines; a skipped line must read as untouched.
function trimHunk(hunk: string, selected: number[], reverse: boolean): string {
  const [head, ...body] = hunk.split(/(?<=\n)/);
  let out = head;
  let ordinal = 0;
  let keptPrev = true;
  for (const line of body) {
    const sign = line[0];
    if (sign === "+" || sign === "-") {
      const chosen = selected.includes(ordinal);
      ordinal += 1;
      if (chosen) {
        out += line;
        keptPrev = true;
      } else if ((sign === "+") === reverse) {
        out += ` ${line.slice(1)}`;
        keptPrev = true;
      } else {
        keptPrev = false;
      }
    } else if (sign === "\\") {
      if (keptPrev) out += line;
    } else {
      out += line;
      keptPrev = true;
    }
  }
  if (selected.length === 0 || selected.some((n) => n >= ordinal)) {
    throw new Error("select at least one changed line of this hunk");
  }
  return out;
}

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
  apply_hunk: (args) => applySelection(args),
  apply_hunk_lines: (args) => applySelection(args),
};

// Mirrors apply_hunk_in / apply_hunk_lines_in: rebuild the patch from a fresh diff, refuse a
// hunk that moved; `lines` (when present) narrows it to chosen +/- lines.
function applySelection({ dir, path: filePath, side, hunkIndex, hunkHeader, action, lines }: Record<string, unknown>) {
  const cwd = String(dir);
  const file = String(filePath);
  const picked = Array.isArray(lines) ? (lines as number[]) : undefined;
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
      if (picked) throw new Error("a new file has no lines to pick from yet — stage the hunk instead");
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
  const header = diff.slice(0, at);
  if (picked && /^(new|deleted) file mode/m.test(header)) {
    throw new Error("lines can only be picked in a file that exists on both sides — use the hunk buttons");
  }
  const body = picked ? trimHunk(hunk, picked, applyFlags.includes("--reverse")) : hunk;
  execFileSync("git", ["apply", "--recount", "--whitespace=nowarn", ...applyFlags, "-"], {
    cwd,
    input: header + body,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return null;
}
