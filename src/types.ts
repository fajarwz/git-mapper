export type RefType = "branch" | "remote" | "tag" | "stash" | "head";

/** A label rendered beside the commit subject: local branch, remote branch, tag, stash, or the detached-HEAD marker. */
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
  /** Unified lines, or null until the lazy patch read lands (gitLoader.loadFilePatch). */
  diff: DiffLine[] | null;
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
   * The uncommitted row's dirty-path count: its rows speak through an amber pill, not a
   * hash, so the count rides along with the row that shows it.
   */
  changedCount?: number;
  /**
   * Set on the row built for a stash entry: `stash@{stashIndex}`. Synthetic rows like this (and
   * the uncommitted one) are not part of the log, so refresh/load-more keep them apart.
   */
  stashIndex?: number;
  /** Files+diff load lazily per selected commit (see gitLoader.loadCommitFiles). */
}

/** `draft` is an open PR marked as a draft. */
export enum PullRequestState {
  Open = "open",
  Draft = "draft",
  Merged = "merged",
  Closed = "closed",
}
export enum ChecksState {
  Passing = "passing",
  Failing = "failing",
  Pending = "pending",
  None = "none",
}

export enum ReviewState {
  Approved = "approved",
  Changes = "changes",
  Required = "required",
}

export enum PullRequestProvider {
  GitHub = "github",
  GitLab = "gitlab",
}

/** Which slice of a repo's requests a list shows: open (drafts included), merged, or every state. */
export enum PullScope {
  Open = "open",
  Merged = "merged",
  All = "all",
}

/** Provider-neutral: the gh adapter (GitHub) and the glab adapter (GitLab) both fill it. */
export interface PullRequest {
  provider: PullRequestProvider;
  /** GitHub's number, GitLab's iid. */
  number: number;
  title: string;
  state: PullRequestState;
  author: string;
  headBranch: string;
  baseBranch: string;
  url: string;
  updatedAt: string;
  checks: ChecksState;
  review: ReviewState | null;
  /** From a fork: its head branch name says nothing about a local branch of the same name. */
  fromFork: boolean;
  /**
   * Full hash of the commit this request made on its base branch once merged. A squash or rebase
   * merge leaves no trace of the branch in history, so this is the only exact link back; null
   * while open, or when the provider does not say.
   */
  mergeCommit: string | null;
}

/** Why there may be no list: each non-ok state has its own explanation in the UI. */
export enum PullRequestsStatus {
  Ok = "ok",
  CliMissing = "cli-missing",
  CliUnauthenticated = "cli-unauthenticated",
  UnsupportedRemote = "unsupported-remote",
}

/** `moved`: checked out at a commit other than the one the parent records. */
export type SubmoduleState = "ok" | "moved" | "uninitialized" | "conflict";

export interface Submodule {
  /** Path relative to the parent repo root, as listed in .gitmodules. */
  path: string;
  /** Absolute path; doubles as the id its Repository gets once opened. */
  fullPath: string;
  name: string;
  state: SubmoduleState;
  /** The commit it sits at (the recorded one while uninitialized). */
  commit: string;
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
  /** True while a merge sits unresolved (MERGE_HEAD present) — the staging rail's banner. */
  merging?: boolean;
  /** Unmerged paths of that merge, from the same status read; empty otherwise. */
  conflicts?: string[];
  /** Direct submodules; empty or absent when the repo has none. */
  submodules?: Submodule[];
  commits: Commit[];
  /** Commit pre-selected when the tab is first shown. */
  defaultCommitHash: string;
  /** True when the tab sat inactive long enough that its history was dropped to save memory. */
  sleeping?: boolean;
}
