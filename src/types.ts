export type RefType = "branch" | "remote" | "tag";

/** A label rendered beside the commit subject: local branch, remote branch or tag. */
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
  /** Graph column this commit's dot sits in. Authored per row while the layout engine is out of scope. */
  lane: number;
  /** Hashes of the parent commits, in order. Empty for the root commit. */
  parents: string[];
  refs: CommitRef[];
  /** Files+diff load lazily per selected commit (see gitLoader.loadCommitFiles). */
}

export interface Repository {
  id: string;
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  commits: Commit[];
  /** Commit pre-selected when the tab is first shown. */
  defaultCommitHash: string;
}
