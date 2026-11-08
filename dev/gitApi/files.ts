// Dev-server mirror of src-tauri/src/git/files.rs (browser tabs have no Tauri backend).
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
// @ts-expect-error type error without @types/node package
import path from "node:path";
// @ts-expect-error type error without @types/node package
import { execFileSync } from "node:child_process";
import { type Handlers, run } from "./git.ts";

/** Mirrors untracked_entry in src-tauri/src/git.rs: `git diff` never lists untracked paths. */
export function untrackedEntry(
  dir: string,
  file: string,
): { numstat: string; nameStatus: string; patch: string } {
  const header = `diff --git a/${file} b/${file}\nnew file mode 100644\n`;
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(dir, file));
  } catch {
    bytes = Buffer.alloc(0);
  }
  const binary = bytes.length > 2 * 1024 * 1024 || bytes.includes(0);
  if (binary) {
    return {
      numstat: `-\t-\t${file}\n`,
      nameStatus: `A\t${file}\n`,
      patch: `${header}--- /dev/null\n+++ b/${file}\n@@ Binary file, not shown @@\n`,
    };
  }
  const lines = bytes.toString("utf8").split("\n");
  // A trailing newline does not invent an extra line.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) {
    return { numstat: `0\t0\t${file}\n`, nameStatus: `A\t${file}\n`, patch: header };
  }
  const cr = String.fromCharCode(13);
  const body = lines.map((line) => `+${line.endsWith(cr) ? line.slice(0, -1) : line}
`).join("");
  return {
    numstat: `${lines.length}\t0\t${file}\n`,
    nameStatus: `A\t${file}\n`,
    patch: `${header}--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${body}`,
  };
}

export const filesHandlers: Handlers = {
  read_commit_files: ({ dir, hash, withPatch }) => {
    const with_patch = withPatch !== false;
    const h = String(hash);
    if (h === "wip") {
      const safe = (args: string[]) => {
        try {
          return run(String(dir), args);
        } catch {
          return "";
        }
      };
      let numstat = safe(["diff", "--numstat", "--no-color", "HEAD"]);
      let name_status = safe(["diff", "--name-status", "--no-color", "HEAD"]);
      let diff = with_patch ? safe(["diff", "--no-color", "HEAD"]) : "";
      // Untracked files are invisible to `git diff`; add them the way git prints a new file.
      for (const file of safe(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")) {
        if (!file) continue;
        const entry = untrackedEntry(String(dir), file);
        numstat += entry.numstat;
        name_status += entry.nameStatus;
        if (with_patch) diff += entry.patch;
      }
      return { numstat, name_status, diff };
    }
    let isRoot = false;
    try {
      execFileSync("git", ["rev-parse", "--verify", `${h}^1`], { cwd: String(dir), encoding: "utf8" });
    } catch {
      isRoot = true;
    }
    const base = isRoot
      ? ["show", "--root", "--format=", "--no-color", h]
      : ["diff", "--no-color", `${h}^1`, h];
    const runVariant = (flag: string) =>
      // Flag position matters: `--numstat` must come after the sub-command (show/diff).
      run(String(dir), flag ? [base[0], flag, ...base.slice(1)] : base);
    const payload = {
      numstat: runVariant("--numstat"),
      name_status: runVariant("--name-status"),
      diff: with_patch ? runVariant("") : "",
    };
    // `git stash -u` parks untracked files in a third parent: a parentless commit holding
    // only those files, so `git show` prints them as additions. Mirrors the `^3` branch in
    // src-tauri/src/git.rs.
    let hasThird = false;
    try {
      execFileSync("git", ["rev-parse", "--verify", `${h}^3`], { cwd: String(dir), encoding: "utf8" });
      hasThird = true;
    } catch {
      // No untracked part.
    }
    if (hasThird) {
      const extra = (flag: string) => {
        const args = ["show"];
        if (flag) args.push(flag);
        args.push("--no-color", "--format=", `${h}^3`);
        return run(String(dir), args);
      };
      payload.numstat += extra("--numstat");
      payload.name_status += extra("--name-status");
      if (with_patch) payload.diff += extra("");
    }
    return payload;
  },
  // One file's patch — the lazy tail of read_commit_files (mirrors git.rs).
  read_file_patch: ({ dir, hash, path: filePath }) => {
    const repoDir = String(dir);
    const h = String(hash);
    const p = String(filePath);
    if (h === "wip") {
      let tracked = "";
      try {
        tracked = run(repoDir, ["diff", "--no-color", "HEAD", "--", p]);
      } catch {
        tracked = "";
      }
      return tracked !== "" ? tracked : untrackedEntry(repoDir, p).patch;
    }
    let parents: string[];
    try {
      parents = run(repoDir, ["rev-list", "--parents", "-1", h]).trim().split(/\s+/).slice(1);
    } catch {
      throw new Error(`"${h}" is not a commit`);
    }
    let patch =
      parents.length === 0
        ? run(repoDir, ["show", "--root", "--format=", "--no-color", h, "--", p])
        : run(repoDir, ["diff", "--no-color", parents[0]!, h, "--", p]);
    if (patch === "" && parents.length >= 3) {
      patch = run(repoDir, ["show", "--no-color", "--format=", parents[2]!, "--", p]);
    }
    return patch;
  },
  // Mirrors read_image_versions in src-tauri/src/git.rs: blob bytes → base64 data URLs.
  read_image_versions: ({ dir, hash, path: filePath }) => {
    const repoDir = String(dir);
    const h = String(hash);
    const p = String(filePath);
    const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
    const runBytes = (args: string[]): Buffer | null => {
      try {
        return execFileSync("git", args, { cwd: repoDir, encoding: "buffer" }) as Buffer;
      } catch {
        return null;
      }
    };
    const utf8 = (args: string[]): string => {
      try {
        return run(repoDir, args);
      } catch {
        return "";
      }
    };
    const mimeFor = (file: string): string => {
      const mimes: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        bmp: "image/bmp",
        ico: "image/x-icon",
        avif: "image/avif",
        apng: "image/apng",
      };
      const ext = file.toLowerCase().split(".").pop() ?? "";
      return mimes[ext] ?? "application/octet-stream";
    };
    const version = (bytes: Buffer | null, file: string) => {
      if (bytes === null) return null;
      if (bytes.length > MAX_IMAGE_BYTES) {
        return { url: "", bytes: bytes.length, tooLarge: true };
      }
      return {
        url: `data:${mimeFor(file)};base64,${bytes.toString("base64")}`,
        bytes: bytes.length,
        tooLarge: false,
      };
    };
    // Empty old rev = no previous copy (root commit, or unborn branch under wip).
    let oldRev = "";
    if (h === "wip") {
      if (utf8(["rev-parse", "--verify", "HEAD"]).trim() !== "") oldRev = "HEAD";
    } else if (utf8(["rev-parse", "--verify", `${h}^1`]).trim() !== "") {
      oldRev = `${h}^1`;
    }
    const blob = (rev: string, file: string) =>
      rev === "" ? null : runBytes(["cat-file", "blob", `${rev}:${file}`]);
    let oldBytes = blob(oldRev, p);
    if (oldBytes === null && oldRev !== "") {
      // A rename moved the file: the old blob lives under the source path (R/C entries).
      const status = utf8(oldRev === "HEAD"
        ? ["diff", "--no-color", "--name-status", "HEAD"]
        : ["diff", "--no-color", "--name-status", oldRev, h]);
      for (const line of status.split("\n")) {
        const fields = line.split("\t");
        if (fields.length >= 3 && /^[RC]/.test(fields[0]) && fields[2] === p) {
          oldBytes = blob(oldRev, fields[1]);
          break;
        }
      }
    }
    const newBytes =
      h === "wip"
        ? (() => {
            try {
              return fs.readFileSync(path.join(repoDir, p));
            } catch {
              return null; // Vanished between the file list and this read.
            }
          })()
        : blob(h, p);
    return { old: version(oldBytes, p), new: version(newBytes, p) };
  },
};
