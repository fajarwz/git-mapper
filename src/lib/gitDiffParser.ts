import type { ChangedFile, DiffLine, FileStatus } from "../types";

export interface RawCommitFiles {
  numstat: string;
  name_status: string;
  diff: string;
}

const STATUS_TYPES: Record<string, FileStatus> = {
  A: "added",
  C: "added",
  M: "modified",
  T: "modified",
  D: "deleted",
  R: "renamed",
};

/** numstat prints renames as "dir/{old => new}"; the file's live path uses the new side. */
function newNumstatPath(rawPath: string): string {
  const renamed = /^([^{}]*)\{([^}]*)\s+=>\s+([^}]*)\}([^{}]*)$/.exec(rawPath);
  if (!renamed) return rawPath;
  return `${renamed[1]}${renamed[3]}${renamed[4]}`;
}

interface NameStatusEntry {
  status: FileStatus;
  path: string;
  oldPath?: string;
  /** Similarity percent parsed from the R/C code (R100 → 100). */
  score?: number;
}

function parseNameStatus(raw: string): NameStatusEntry[] {
  const out: NameStatusEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    const letter = code[0] ?? "";
    const status = STATUS_TYPES[letter];
    if (!status) continue;
    if (letter === "R" || letter === "C") {
      const score = Number(code.slice(1));
      out.push({
        status,
        path: parts[2],
        oldPath: parts[1],
        score: Number.isFinite(score) ? score : undefined,
      });
    } else {
      out.push({ status, path: parts[1] });
    }
  }
  return out;
}

function parseNumstat(raw: string): Map<string, { additions: number; deletions: number }> {
  const counts = new Map<string, { additions: number; deletions: number }>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(line);
    if (!match) continue;
    counts.set(newNumstatPath(match[3]), {
      additions: match[1] === "-" ? 0 : Number(match[1]),
      deletions: match[2] === "-" ? 0 : Number(match[2]),
    });
  }
  return counts;
}

/**
 * Groups the unified patch per file, keyed by the b-side path (a-side for deletions).
 * DiffLine text carries NO +/- prefix; the renderer adds it back, so the data stays honest.
 */
export function parseDiffSections(raw: string): Map<string, DiffLine[]> {
  const sections = new Map<string, DiffLine[]>();
  let currentPath: string | null = null;
  let oldPath: string | null = null;
  let inHeader = true;
  let current: DiffLine[] = [];

  const flush = () => {
    const key = currentPath ?? oldPath;
    if (key !== null && current.length > 0) sections.set(key, current);
    current = [];
  };

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      flush();
      currentPath = null;
      oldPath = null;
      inHeader = true;
      continue;
    }
    if (inHeader) {
      if (line.startsWith("--- ")) {
        oldPath = line.startsWith("--- a/") ? line.slice(6) : null;
      } else if (line.startsWith("+++ ")) {
        currentPath = line.startsWith("+++ b/") ? line.slice(6) : null;
        inHeader = false;
      } else if (line.startsWith("@@")) {
        // Merge-commit patches: the parents header precedes; treat patch body as ready.
        inHeader = false;
      }
      continue;
    }
    if (line.startsWith("@@")) {
      current.push({ type: "hunk", text: line });
    } else if (line.startsWith("+")) {
      current.push({ type: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      current.push({ type: "remove", text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      current.push({ type: "context", text: line.slice(1) });
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" — not a content line.
    } else if (line.trim() === "") {
      current.push({ type: "context", text: "" });
    }
  }
  flush();
  return sections;
}

export interface DiffSplitRow {
  /** Hunk header row: spans both panes, old/new are empty. */
  hunk: DiffLine | null;
  /** Left pane (a remove or context) and right pane (an add or context) of one visual row. */
  old: DiffLine | null;
  new: DiffLine | null;
  /** Where each side's line sits in the source list (-1 when absent), for highlight lookups. */
  oldIndex: number;
  newIndex: number;
}

/**
 * Pairs a unified line list into side-by-side rows (GitHub's split view): context shows on both
 * sides, a block of removes and adds zips into rows, and whichever side runs out stays empty.
 */
export function splitDiffRows(lines: DiffLine[]): DiffSplitRow[] {
  const rows: DiffSplitRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;
    if (line.type === "hunk") {
      rows.push({ hunk: line, old: null, new: null, oldIndex: -1, newIndex: -1 });
      index += 1;
      continue;
    }
    if (line.type === "context") {
      rows.push({ hunk: null, old: line, new: line, oldIndex: index, newIndex: index });
      index += 1;
      continue;
    }
    const removes: Array<[DiffLine, number]> = [];
    const adds: Array<[DiffLine, number]> = [];
    while (index < lines.length) {
      const pending = lines[index];
      if (!pending || pending.type === "context" || pending.type === "hunk") break;
      (pending.type === "remove" ? removes : adds).push([pending, index]);
      index += 1;
    }
    const count = Math.max(removes.length, adds.length);
    for (let k = 0; k < count; k += 1) {
      const old = removes[k];
      const add = adds[k];
      rows.push({
        hunk: null,
        old: old?.[0] ?? null,
        new: add?.[0] ?? null,
        oldIndex: old?.[1] ?? -1,
        newIndex: add?.[1] ?? -1,
      });
    }
  }
  return rows;
}

export function parseCommitFiles(payload: RawCommitFiles): ChangedFile[] {
  const sections = parseDiffSections(payload.diff);
  const counts = parseNumstat(payload.numstat);

  return parseNameStatus(payload.name_status).map((entry) => {
    const count = counts.get(entry.path) ?? { additions: 0, deletions: 0 };
    return {
      path: entry.path,
      oldPath: entry.oldPath,
      renameScore: entry.score,
      status: entry.status,
      additions: count.additions,
      deletions: count.deletions,
      diff: sections.get(entry.path) ?? [],
    };
  });
}
