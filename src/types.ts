export type RefType = "branch" | "remote" | "tag" | "stash" | "head";

export interface CommitRef {
  type: RefType;
  name: string;
  isCurrent?: boolean;
  withRemote?: string;
}

export enum RemoteCheckoutMode {
  Create = "create",
  Existing = "existing",
}

export enum DeleteOutcome {
  Deleted = "deleted",
  NotMerged = "not-merged",
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export type DiffLineType = "hunk" | "context" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface ChangedFile {
  path: string;
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
  lane: number;
  branchColor: number;
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
}

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

export enum PullScope {
  Open = "open",
  Merged = "merged",
  All = "all",
}

export interface PullRequest {
  provider: PullRequestProvider;
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

export type SubmoduleState = "ok" | "moved" | "uninitialized" | "conflict";

export interface Submodule {
  path: string;
  fullPath: string;
  name: string;
  state: SubmoduleState;
  commit: string;
}

export interface Repository {
  id: string;
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  head: string;
  changed: number;
  /** Digest of the working tree at load time: notices content edits the count cannot. */
  worktree: string;
  refsDigest: string;
  /** Digest of the stash list: taking or dropping a stash changes it, not the refs above. */
  stashDigest: string;
  merging?: boolean;
  /** Unmerged paths of that merge, from the same status read; empty otherwise. */
  conflicts?: string[];
  submodules?: Submodule[];
  commits: Commit[];
  defaultCommitHash: string;
  sleeping?: boolean;
}
