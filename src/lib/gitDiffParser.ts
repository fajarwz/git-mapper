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
}

function parseNameStatus(raw: string): NameStatusEntry[] {
  const out: NameStatusEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const letter = parts[0][0] ?? "";
    const status = STATUS_TYPES[letter];
    if (!status) continue;
    if (letter === "R" || letter === "C") {
      out.push({ status, path: parts[2], oldPath: parts[1] });
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

export function parseCommitFiles(payload: RawCommitFiles): ChangedFile[] {
  const sections = parseDiffSections(payload.diff);
  const counts = parseNumstat(payload.numstat);

  return parseNameStatus(payload.name_status).map((entry) => {
    const count = counts.get(entry.path) ?? { additions: 0, deletions: 0 };
    return {
      path: entry.path,
      status: entry.status,
      additions: count.additions,
      deletions: count.deletions,
      diff: sections.get(entry.path) ?? [],
    };
  });
}
