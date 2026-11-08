// Dev-server mirror of src-tauri/src/git/status.rs (browser tabs have no Tauri backend).
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
// @ts-expect-error type error without @types/node package
import path from "node:path";
// @ts-expect-error type error without @types/node package
import { execFileSync } from "node:child_process";
import { type Handlers, run } from "./git.ts";
import { mergingNow, unmergedPaths } from "./merge.ts";

/** FNV-1a: the stamps below are only compared for equality between two reads. */
export function digest(text: string): string {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash ^ text.charCodeAt(index)) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${hash.toString(16)}:${text.length}`;
}

/** Mirrors worktree_stamp in src-tauri/src/git.rs: status list + tracked patch + untracked stats. */
export function worktreeStamp(dir: string, statusOut: string, changed: number): string {
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

export type StatusVisit = (x: string, y: string, path: string, orig: string | null) => void;

export function eachStatusV2(raw: string, visit: StatusVisit): void {
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
    if (kind === "u") {
      // `u XY <9 header fields> <path>`: the resolver's rows, sides included in the XY.
      if (rest.length < 2) continue;
      const ux = rest[0];
      const uy = rest[1];
      const utail = rest.slice(2);
      let useen = 0;
      let upathAt = -1;
      for (let offset = 0; offset < utail.length; offset += 1) {
        if (utail.charAt(offset) === " ") {
          useen += 1;
          if (useen === 9) {
            upathAt = offset + 1;
            break;
          }
        }
      }
      if (upathAt === -1) continue;
      visit(ux, uy, utail.slice(upathAt).trimEnd(), null);
      continue;
    }
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

export function statusKind(letter: string): string {
  switch (letter) {
    case "A": return "added";
    case "D": return "deleted";
    case "R":
    case "C": return "renamed";
    // M plus T (typechange); the panel has no typechange voice, modified tells the story.
    default: return "modified";
  }
}

export function numstatMap(raw: string): Map<string, [number, number]> {
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
export function untrackedCounts(dir: string, file: string): [number, number] {
  try {
    const bytes = fs.readFileSync(path.join(dir, file));
    if (bytes.length > 2 * 1024 * 1024 || bytes.includes(0)) return [0, 0];
    return [bytes.toString("utf8").split("\n").length - (bytes.toString("utf8").endsWith("\n") ? 1 : 0), 0];
  } catch {
    return [0, 0];
  }
}

export function statusRaw(dir: string): string {
  try {
    return run(dir, ["status", "--porcelain=v2", "--untracked-files=all", "-z"]);
  } catch {
    return "";
  }
}

export function readWorktreeFiles(dir: string): { entries: unknown[] } {
  const [statusOut, stagedOut, worktreeOut] = [
    statusRaw(dir),
    run(dir, ["diff", "--numstat", "-z", "--cached"]),
    run(dir, ["diff", "--numstat", "-z"]),
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

export function stagedRenames(dir: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const raw = statusRaw(dir);
  eachStatusV2(raw, (x, _y, entryPath, orig) => {
    if (x === "R" && orig) pairs.push([entryPath, orig]);
  });
  return pairs;
}

export const statusHandlers: Handlers = {
  open_repository: ({ dir }) => {
    if (run(String(dir), ["rev-parse", "--is-inside-work-tree"]).trim() !== "true") {
      throw new Error(`${dir} is not a Git repository`);
    }
    const path = run(String(dir), ["rev-parse", "--show-toplevel"]).trim();
    return { path, name: path.split(/[\\/]/).pop() ?? path };
  },
  read_status: ({ dir }) => {
    const out = run(String(dir), ["status", "-sb", "--untracked-files=all"]);
    const merging = mergingNow(String(dir));
    const conflicts = merging ? unmergedPaths(String(dir)) : [];
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
      merging,
      conflicts,
      changed,
      head: headSha,
      worktree: worktreeStamp(String(dir), out, changed),
    };
  },
  read_worktree_files: ({ dir }) => readWorktreeFiles(String(dir)),
};
