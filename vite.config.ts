import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
// @ts-expect-error type error without @types/node package
import path from "node:path";
import { execFileSync } from "node:child_process";
const host = process.env.TAURI_DEV_HOST;
// `tauri dev` hard-wires its devUrl to port 1420, so under the Tauri CLI the port must stay
// fixed: drifting to 1421 would leave the window loading whatever else answers 1420. A plain
// `npm run dev` (browser work, headless probes) may step to the next free port instead.
const underTauriCli = process.env.TAURI_ENV_PLATFORM !== undefined;

/** FNV-1a: the stamps below are only compared for equality between two reads. */
function digest(text: string): string {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash ^ text.charCodeAt(index)) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${hash.toString(16)}:${text.length}`;
}

/** Mirrors worktree_stamp in src-tauri/src/git.rs: status list + tracked patch + untracked stats. */
function worktreeStamp(dir: string, statusOut: string, changed: number): string {
  let stamp = statusOut;
  if (changed === 0) return digest(stamp);
  try {
    stamp += execFileSync("git", ["diff", "--no-color", "HEAD"], { cwd: dir, encoding: "utf8" });
  } catch {
    // Unborn branch: no HEAD to diff against; the status list alone has to do.
  }
  for (const line of statusOut.split("\n")) {
    if (!line.startsWith("?? ")) continue;
    const file = line.slice(3);
    try {
      const meta = fs.statSync(path.join(dir, file));
      stamp += `\u0001${file}:${meta.size}:${meta.mtimeMs}`;
    } catch {
      // Vanished between the status read and here.
    }
  }
  return digest(stamp);
}

/** Mirrors untracked_entry in src-tauri/src/git.rs: `git diff` never lists untracked paths. */
function untrackedEntry(
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

// ---------------------------------------------------------------------------
// Staging-rail plumbing: a TS port of git.rs's porcelain v2 reader. The record grammar is
// `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` (renames: `2 … <score> <path>` + the source
// as the next NUL token; untracked: `? <path>`, no XY at all), and numstat -z reports renames
// as separate delete + add records — the destination path is the direct key.

type StatusVisit = (x: string, y: string, path: string, orig: string | null) => void;

function eachStatusV2(raw: string, visit: StatusVisit): void {
  let cursor = 0;
  while (cursor < raw.length) {
    const relEnd = raw.indexOf("\0", cursor);
    if (relEnd === -1) break;
    const record = raw.slice(cursor, relEnd).trimEnd();
    cursor = relEnd + 1;
    if (record === "") continue; // rename records are `path\0orig\0`; the empty gap is a terminator
    const kindEnd = record.indexOf(" ");
    if (kindEnd === -1) continue;
    const kind = record.slice(0, kindEnd);
    const rest = record.slice(kindEnd + 1);
    if (kind === "u") continue; // unmerged: outside the viewer's scope
    if (kind === "?") {
      visit("?", "?", rest, null);
      continue;
    }
    if (kind !== "1" && kind !== "2" || rest.length < 2) continue;
    const x = rest[0];
    const y = rest[1];
    const tail = rest.slice(2);
    const headers = kind === "2" ? 8 : 7; // header separators, incl. the one after the XY pair
    let seen = 0;
    let pathAt = -1;
    for (let offset = 0; offset < tail.length; offset += 1) {
      if (tail.charAt(offset) === " ") {
        seen += 1;
        if (seen === headers) {
          pathAt = offset + 1;
          break;
        }
      }
    }
    if (pathAt === -1) continue;
    const entryPath = tail.slice(pathAt).trimEnd();
    let orig: string | null = null;
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      const relOrig = raw.indexOf("\0", cursor);
      if (relOrig === -1) break;
      orig = raw.slice(cursor, relOrig);
      cursor = relOrig + 1;
    }
    visit(x, y, entryPath, orig);
  }
}

function statusKind(letter: string): string {
  switch (letter) {
    case "A": return "added";
    case "D": return "deleted";
    case "R":
    case "C": return "renamed";
    // M plus T (typechange); the panel has no typechange voice, modified tells the story.
    default: return "modified";
  }
}

function numstatMap(raw: string): Map<string, [number, number]> {
  const map = new Map<string, [number, number]>();
  for (const token of raw.split("\0")) {
    if (token.trim() === "") continue;
    const fields = token.split("\t");
    if (fields.length < 3) continue;
    const add = /^\d+$/.test(fields[0].trim()) ? Number(fields[0]) : 0;
    const del = /^\d+$/.test(fields[1].trim()) ? Number(fields[1]) : 0;
    map.set(fields[2], [add, del]);
  }
  return map;
}

/** Line count of an untracked file, mirroring git.rs's binary/size guard. */
function untrackedCounts(dir: string, file: string): [number, number] {
  try {
    const bytes = fs.readFileSync(path.join(dir, file));
    if (bytes.length > 2 * 1024 * 1024 || bytes.includes(0)) return [0, 0];
    return [bytes.toString("utf8").split("\n").length - (bytes.toString("utf8").endsWith("\n") ? 1 : 0), 0];
  } catch {
    return [0, 0];
  }
}

function runGitRaw(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

function statusRaw(dir: string): string {
  try {
    return runGitRaw(dir, ["status", "--porcelain=v2", "--untracked-files=all", "-z"]);
  } catch {
    return "";
  }
}

function runWith(dir: string, args: string[]): string {
  return runGitRaw(dir, args);
}

function readWorktreeFiles(dir: string): { entries: unknown[] } {
  const [statusOut, stagedOut, worktreeOut] = [
    statusRaw(dir),
    runWith(dir, ["diff", "--numstat", "-z", "--cached"]),
    runWith(dir, ["diff", "--numstat", "-z"]),
  ];
  const stagedMap = numstatMap(stagedOut);
  const worktreeMap = numstatMap(worktreeOut);
  const entries: Array<Record<string, unknown>> = [];
  const push = (prefix: string, entryPath: string, oldPath: string | null, letter: string, untracked: boolean, counts: [number, number]) => {
    entries.push({
      key: `${prefix}:${entryPath}`,
      path: entryPath,
      old_path: oldPath,
      status: statusKind(letter),
      staged: prefix === "index",
      untracked,
      additions: counts[0],
      deletions: counts[1],
    });
  };
  eachStatusV2(statusOut, (x, y, entryPath, orig) => {
    if (x !== "." && x !== "?") {
      push("index", entryPath, orig, x, false, stagedMap.get(entryPath) ?? [0, 0]);
    }
    if (y === "?") {
      push("worktree", entryPath, null, "A", true, untrackedCounts(dir, entryPath));
    } else if (y !== ".") {
      push("worktree", entryPath, orig, y, false, worktreeMap.get(entryPath) ?? [0, 0]);
    }
  });
  entries.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  entries.sort((a, b) => Number(b.staged) - Number(a.staged));
  return { entries };
}

function stagedRenames(dir: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const raw = statusRaw(dir);
  eachStatusV2(raw, (x, _y, entryPath, orig) => {
    if (x === "R" && orig) pairs.push([entryPath, orig]);
  });
  return pairs;
}

// Browser-tab fallback for the Git plumbing: same command names as
// src-tauri/src/git.rs, run directly by the dev server. Dev-only.
function gitDevApi(): Plugin {
  const run = (dir: string, args: string[]): string =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    open_repository: ({ dir }) => {
      if (run(String(dir), ["rev-parse", "--is-inside-work-tree"]).trim() !== "true") {
        throw new Error(`${dir} is not a Git repository`);
      }
      const path = run(String(dir), ["rev-parse", "--show-toplevel"]).trim();
      return { path, name: path.split(/[\\/]/).pop() ?? path };
    },
    read_status: ({ dir }) => {
      const out = run(String(dir), ["status", "-sb", "--untracked-files=all"]);
      const line = out.split("\n").find((l) => l.startsWith("## ")) ?? "";
      const head = line.slice(3).trim();
      const [branchPart, tail] = head.split("...");
      let ahead = 0;
      let behind = 0;
      for (const m of (tail ?? "").matchAll(/(ahead|behind) (\d+)/g)) {
        if (m[1] === "ahead") ahead = Number(m[2]);
        else behind = Number(m[2]);
      }
      const changed = out
        .split("\n")
        .filter((l) => l.trim() !== "" && !l.startsWith("## ")).length;
      let headSha = "";
      try {
        headSha = run(String(dir), ["rev-parse", "--verify", "HEAD"]).trim();
      } catch {
        headSha = "";
      }
      return {
        branch: branchPart ?? "HEAD detached",
        ahead,
        behind,
        dirty: changed > 0,
        changed,
        head: headSha,
        worktree: worktreeStamp(String(dir), out, changed),
      };
    },
    read_log: ({ dir, limit, skip }) => ({
      text: run(
        String(dir),
        ["log", "--exclude=refs/stash", "--all", "--date-order", `--max-count=${Number(limit) || 500}`, `--skip=${Number(skip) || 0}`, "--date=iso-strict",
          "--pretty=tformat:%d%x00%H%x00%an%x00%ae%x00%aI%x00%P%x00%B%x1e"],
      ),
    }),
    read_log_order: ({ dir, limit }) => ({
      text: run(String(dir), [
        "log",
        "--exclude=refs/stash", "--all", "--date-order",
        `--max-count=${Number(limit) || 500}`,
        "--date=iso-strict",
        "--pretty=tformat:%H",
      ]),
    }),
    read_log_delta: ({ dir, since, limit }) => {
      const rev = String(since ?? "").trim();
      const base = [
        "log",
        "--exclude=refs/stash", "--all", "--date-order",
        `--max-count=${Number(limit) || 500}`,
      ];
      if (rev !== "") base.push(`^${rev}`);
      base.push("--date=iso-strict", "--pretty=tformat:%d%x00%H%x00%an%x00%ae%x00%aI%x00%P%x00%B%x1e");
      return { text: run(String(dir), base) };
    },
    read_refs: ({ dir }) => ({
      text: run(String(dir), [
        "for-each-ref",
        "--format=%(objectname)%09%(refname)",
        "refs/heads",
        "refs/remotes",
        "refs/tags",
      ]),
    }),
    read_stashes: ({ dir }) => ({
      text: run(String(dir), [
        "stash",
        "list",
        "--pretty=tformat:%gd%x00%H%x00%P%x00%an%x00%ae%x00%cI%x00%gs%x1e",
      ]),
    }),
    checkout_branch: ({ dir, branch }) => {
      run(String(dir), ["checkout", String(branch)]);
      return null;
    },
    checkout_commit: ({ dir, hash }) => {
      const h = String(hash).trim();
      if (h.length < 4 || h.length > 40 || !/^[0-9a-fA-F]+$/.test(h)) {
        throw new Error(`"${h}" is not a commit hash`);
      }
      run(String(dir), ["checkout", "--detach", h]);
      return null;
    },
    stash_action: ({ dir, index, action }) => {
      const verb = String(action);
      if (verb !== "apply" && verb !== "pop" && verb !== "drop") {
        throw new Error(`"${verb}" is not a stash action`);
      }
      const n = Math.trunc(Number(index));
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`"${index}" is not a stash position`);
      }
      run(String(dir), ["stash", verb, `stash@{${n}}`]);
      return null;
    },
    fetch_remote: ({ dir }) => {
      const remotes = String(run(String(dir), ["remote"])).trim();
      if (!remotes) return null;
      run(String(dir), ["fetch", "--all", "--prune", "--quiet"]);
      return null;
    },
    pull_branch: ({ dir }) =>
      run(String(dir), ["pull", "--ff-only", "--no-edit"]),
    push_branch: ({ dir }) =>
      run(String(dir), ["push", "-u", "origin", "HEAD"]),
    read_worktree_files: ({ dir }) => readWorktreeFiles(String(dir)),
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
        runWith(dirPath, ["ls-tree", "-r", "--name-only", "-z", "HEAD"]).split("\0").filter(Boolean),
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
      for (const p of fromDisk) fsSync.rmSync(path.join(dirPath, p), { force: true });
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
      const staged = runWith(dirPath, ["diff", "--cached", "--name-only", "-z"]);
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

  return {
    name: "git-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/git", (req, res) => {
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
              op: string;
              args: Record<string, unknown>;
            };
            const handler = handlers[body.op];
            if (!handler) throw new Error(`unknown op ${body.op}`);
            const result = handler(body.args ?? {});
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result ?? null));
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        })();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), svgr(), gitDevApi()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri's window loads http://localhost:1420, so under `tauri dev` fail rather than drift
  //    to another port and quietly show a different server
  server: {
    port: 1420,
    strictPort: underTauriCli,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
