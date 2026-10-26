export type RefType = "branch" | "remote" | "tag" | "stash";

/** A label rendered beside the commit subject: local branch, remote branch, tag or stash. */
export interface CommitRef {
  type: RefType;
  name: string;
  /** True for the branch the working copy currently has checked out. */
  isCurrent?: boolean;
  /** Local branch paired with its remote: pill renders "name | <remote>" (Git Graph style). */
  withRemote?: string;
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export type DiffLineType = "hunk" | "context" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface ChangedFile {
  path: string;
  /** For renames/copies: the path the file moved from, shown as "old → new". */
  oldPath?: string;
  /** Rename/copy similarity in percent (git's R100 → 100); only present for renames. */
  renameScore?: number;
  status: FileStatus;
  additions: number;
  deletions: number;
  diff: DiffLine[];
}

export interface Commit {
  /** Short hash, the only form this mock UI displays. */
  hash: string;
  subject: string;
  body?: string;
  author: string;
  authorEmail: string;
  /** ISO timestamp; rendered absolute ("23 Oct 2026 12:09"), never relative. */
  date: string;
  /** Graph column this commit's dot sits in, from layoutGraph. */
  lane: number;
  /** Branch colour index for this commit's dot and its connecting lines. */
  branchColor: number;
  /** Hashes of the parent commits, in order. Empty for the root commit. */
  parents: string[];
  refs: CommitRef[];
  /**
   * Set on the row built for a stash entry: `stash@{stashIndex}`. Synthetic rows like this (and
   * the uncommitted one) are not part of the log, so refresh/load-more keep them apart.
   */
  stashIndex?: number;
  /** Files+diff load lazily per selected commit (see gitLoader.loadCommitFiles). */
}

export interface Repository {
  id: string;
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  /** HEAD commit sha at load time; used to notice commits made elsewhere. */
  head: string;
  /** Changed path count at load time, so working-tree edits are noticed too. */
  changed: number;
  /** Digest of the working tree at load time: notices content edits the count cannot. */
  worktree: string;
  /** Digest of all branch/remote/tag refs at load time; a fetch changes it. */
  refsDigest: string;
  /** Digest of the stash list: taking or dropping a stash changes it, not the refs above. */
  stashDigest: string;
  commits: Commit[];
  /** Commit pre-selected when the tab is first shown. */
  defaultCommitHash: string;
}
