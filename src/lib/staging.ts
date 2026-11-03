import type { ChangedFile, FileStatus } from "../types";

/** One raw `1 <XY> … <path>`-shaped entry that the status reader returned. */
export interface WorktreeEntryRaw {
  /** `index:<path>` or `worktree:<path>` — one path can legitimately carry both copies. */
  key: string;
  path: string;
  /** Rename/copy source (`git mv` / detected rename) in the same state. */
  old_path?: string | null;
  status: string;
  staged: boolean;
  untracked: boolean;
  additions: number;
  deletions: number;
}

/**
 * A working-copy change in ONE of its copies: the index (what a commit would take) or the
 * worktree (what the disk holds). A file staged and then edited again is TWO rows — each copy
 * its own story, especially for line counts.
 */
export interface WorktreeFile extends ChangedFile {
  key: string;
  staged: boolean;
  /** True for worktree rows git does not track yet: the discard deletes the file from disk. */
  untracked: boolean;
}

/**
 * Shapes the reader output for the panel: index rows first (that is the commit candidate),
 * each section alphabetical. Old paths are the rust snake_case names here on purpose — the
 * field is only renamed while shaping, never leaking past this file.
 */
export function shapeWorktreeFiles(entries: WorktreeEntryRaw[]): WorktreeFile[] {
  const shaped: WorktreeFile[] = entries.map((entry) => ({
    key: entry.key,
    path: entry.path,
    oldPath: entry.old_path ?? undefined,
    status: entry.status as FileStatus,
    additions: entry.additions,
    deletions: entry.deletions,
    staged: entry.staged,
    untracked: entry.untracked,
    diff: [],
  }));
  return shaped.sort((a, b) =>
    a.staged === b.staged ? a.path.localeCompare(b.path) : a.staged ? -1 : 1,
  );
}
