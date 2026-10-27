import { invoke } from "@tauri-apps/api/core";
import { open as pickDirectory } from "@tauri-apps/plugin-dialog";
import type { ChangedFile, Commit, CommitRef, Repository } from "../types";
import { STORAGE_KEYS } from "../lib/persisted";
import { orderRefs } from "../lib/refOrder";
import { layoutGraph } from "../lib/graphLanes";
import { parseCommitFiles } from "../lib/gitDiffParser";
import { parseLog, parseStashes } from "../lib/gitLogParser";
import type { LogStash } from "../lib/gitLogParser";

const LOG_LIMIT = 500;

/** invoke() exists only inside the Tauri webview; browser tabs fall back to the dev middleware. */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Same command names the Rust module exposes; POST /api/git serves browser tabs. */
function devApi(op: string, args: Record<string, unknown>): Promise<unknown> {
  return fetch("/api/git", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, args }),
  }).then(async (response) => {
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `git ${op} failed (${response.status})`);
    }
    return response.json();
  });
}

async function call<T>(op: string, args: Record<string, unknown>, unwrap: (raw: unknown) => T): Promise<T> {
  const raw = isTauri() ? await invoke(op, args) : await devApi(op, args);
  return unwrap(raw);
}

/** Pseudo-commit hash for the "Uncommitted changes" row (Rust + middleware treat it the same). */
export const UNCOMMITTED_HASH = "wip";

/** How long an inactive tab keeps its history before it is dropped, and how often that is checked. */
export const SLEEP_AFTER_MS = 5 * 60_000;
export const SLEEP_TICK_MS = 30_000;
/** Changed-file payloads (full patch text) kept across all repos; the least recent used is dropped. */
export const FILES_CACHE_CAP = 32;

export const OPEN_REPOS_KEY = STORAGE_KEYS.repos;

interface RepoInfo {
  path: string;
  name: string;
}

interface StatusInfo {
  branch: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  /** Changed paths in the working tree, untracked files counted individually. */
  changed: number;
  /** HEAD commit sha; empty on an unborn branch. */
  head: string;
  /** Digest of the working tree: catches an edit inside a file the count already included. */
  worktree: string;
}

/** Cheap, stable digest: we only ever compare ref snapshots for equality. */
function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

/**
 * Decoration refs first, then the for-each-ref tips. Both describe the same refs, so the
 * dedupe is left to orderRefs: filtering tips out here threw away the copy that knew the
 * branch's remote, which is why a refreshed pill read `main` instead of `main | origin`.
 */
function mergeRefs(decorations: CommitRef[], tips: CommitRef[]): CommitRef[] {
  return orderRefs([...decorations, ...tips]);
}

function toCommits(parsed: ReturnType<typeof parseLog>): Commit[] {
  return parsed.map((commit) => ({
    hash: commit.hash,
    subject: commit.subject,
    body: commit.body,
    author: commit.author,
    authorEmail: commit.authorEmail,
    date: commit.date,
    lane: 0,
    branchColor: 0,
    parents: commit.parents,
    refs: commit.refs,
  }));
}

/** True for the rows the app builds itself: the uncommitted row and one per stash entry. */
export function isStashRow(commit: Commit): boolean {
  return commit.stashIndex !== undefined;
}

/**
 * One row per stash entry, newest first. Only the stash commit's first parent is used: that is
 * the commit it was taken on, so the graph hangs the row off the branch it came from. Its other
 * parents (git's index snapshot, the `-u` tree) are plumbing, not history.
 */
function stashRows(stashes: LogStash[]): Commit[] {
  return stashes.map((stash, index) => ({
    hash: stash.hash,
    subject: stash.message,
    author: stash.author,
    authorEmail: stash.authorEmail,
    date: stash.date,
    lane: 0,
    branchColor: 0,
    parents: stash.parents.slice(0, 1),
    refs: [{ type: "stash", name: stash.selector }],
    stashIndex: index,
  }));
}

/** Millisecond stamp of an ISO date; unparseable strings sort oldest so they never land on top. */
function stamp(date: string): number {
  const time = Date.parse(date);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Stashes are not pinned above history: a stash row files by the date the stash was taken, like
 * any other commit. Each row goes before the first history commit older than it, which keeps the
 * list in git's `--date-order` — the stash's base commit is always below its row, so the lane
 * layout still holds. Equal dates keep the stash list's own order (stash@{0} above stash@{1}).
 */
function mergeStashes(history: Commit[], stashes: Commit[]): Commit[] {
  const rows = [...history];
  for (const stash of stashes) {
    const at = rows.findIndex((commit) => stamp(commit.date) < stamp(stash.date));
    if (at === -1) rows.push(stash);
    else rows.splice(at, 0, stash);
  }
  return rows;
}

/** `hash\tfullref` lines → refs grouped by hash, typed by the ref namespace. */
export function parseForEachRef(
  raw: string,
  currentBranch: string,
): Map<string, CommitRef[]> {
  const byHash = new Map<string, CommitRef[]>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const sep = line.indexOf("\t");
    if (sep === -1) continue;
    const hash = line.slice(0, sep);
    const fullname = line.slice(sep + 1);
    let ref: CommitRef | null = null;
    if (fullname.startsWith("refs/heads/")) {
      const name = fullname.slice("refs/heads/".length);
      ref = name === currentBranch
        ? { type: "branch", name, isCurrent: true }
        : { type: "branch", name };
    } else if (fullname.startsWith("refs/remotes/")) {
      ref = { type: "remote", name: fullname.slice("refs/remotes/".length) };
    } else if (fullname.startsWith("refs/tags/")) {
      ref = { type: "tag", name: fullname.slice("refs/tags/".length) };
    }
    if (!ref) continue;
    const list = byHash.get(hash) ?? [];
    // Skip duplicates against decorations from the log (same type+name).
    if (!list.some((existing) => existing.type === ref?.type && existing.name === ref?.name)) {
      list.push(ref);
      byHash.set(hash, list);
    }
  }
  // Order now, not just at load time: a refresh replaces a row's refs with this map, and
  // `orderRefs` is what pairs a local branch with its remote (main | origin). Comparing the raw
  // list against the shaped one failed every time, so those rows dropped their remote suffix and
  // flashed on every refresh.
  return new Map([...byHash].map(([hash, refs]) => [hash, orderRefs(refs)]));
}

function readLog(dir: string, limit: number, skip: number): Promise<string> {
  return call(
    "read_log",
    { dir, limit, skip },
    (raw) => (isTauri() ? (raw as string) : (raw as { text: string }).text),
  );
}

function readStatus(dir: string): Promise<StatusInfo> {
  return call<StatusInfo>("read_status", { dir }, (raw) => raw as StatusInfo);
}

function readLogDelta(dir: string, since: string, limit: number): Promise<string> {
  return call(
    "read_log_delta",
    { dir, since, limit },
    (raw) => (isTauri() ? (raw as string) : (raw as { text: string }).text),
  );
}

function readLogOrder(dir: string, limit: number): Promise<string> {
  return call(
    "read_log_order",
    { dir, limit },
    (raw) => (isTauri() ? (raw as string) : (raw as { text: string }).text),
  );
}

async function readRefs(dir: string): Promise<string> {
  return isTauri()
    ? invoke<string>("read_refs", { dir })
    : ((await devApi("read_refs", { dir })) as { text: string }).text;
}

/** Raw `git stash list` records. Only the newest entry is a ref, so this is the only full list. */
async function readStashes(dir: string): Promise<string> {
  return isTauri()
    ? invoke<string>("read_stashes", { dir })
    : ((await devApi("read_stashes", { dir })) as { text: string }).text;
}

function uncommittedCommit(commits: Commit[], changed: number): Commit {
  const head = commits[0];
  return {
    hash: UNCOMMITTED_HASH,
    subject: changed > 0 ? `Uncommitted changes (${changed})` : "Uncommitted changes",
    author: "",
    authorEmail: "",
    date: new Date().toISOString(),
    lane: 0,
    branchColor: 0,
    parents: [head.hash],
    refs: [],
  };
}

/** Places lanes over the real commits plus, when present, the uncommitted row on top. */
function withLanes(commits: Commit[]): Commit[] {
  const layout = layoutGraph(
    commits.map((c) => ({
      hash: c.hash,
      // Stash rows float: they are snapshots, not history, so they draw no line to the commit
      // they were taken on. A stash on a months-old commit used to hold its lane open for
      // hundreds of rows, and one whose base sat outside the window traced a line to the very
      // bottom — the graph blew up to twice the lanes and the dots clipped out of the column.
      parents: isStashRow(c) ? [] : c.parents,
      uncommitted: c.hash === UNCOMMITTED_HASH,
    })),
  );
  // Reuse the commit object when its lane and colour are unchanged: rows are memoized, so
  // identical objects mean identical renders and no DOM work for history that did not move.
  return commits.map((commit, index) => {
    const lane = layout.lanes[index] ?? 0;
    const branchColor = layout.branchColors[index] ?? 0;
    return commit.lane === lane && commit.branchColor === branchColor
      ? commit
      : { ...commit, lane, branchColor };
  });
}

/** True when two ref lists draw the same pills, so the commit object can be reused. */
function sameRefs(a: CommitRef[], b: CommitRef[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((ref, index) => {
    const other = b[index];
    return (
      ref.type === other.type &&
      ref.name === other.name &&
      ref.isCurrent === other.isCurrent &&
      ref.withRemote === other.withRemote
    );
  });
}

export async function loadRepository(dir: string): Promise<Repository> {
  const info = await call<RepoInfo>("open_repository", { dir }, (raw) => raw as RepoInfo);
  const [status, log, refsRaw, stashesRaw] = await Promise.all([
    call<StatusInfo>("read_status", { dir: info.path }, (raw) => raw as StatusInfo),
    readLog(info.path, LOG_LIMIT, 0),
    readRefs(info.path),
    readStashes(info.path),
  ]);
  const tipRefs = parseForEachRef(refsRaw, status.branch || "");
  const history = toCommits(parseLog(log)).map((commit) => ({
    ...commit,
    refs: mergeRefs(commit.refs, tipRefs.get(commit.hash) ?? []),
  }));
  // Stashes file into history by the date they were taken; the uncommitted row stays on top:
  // the working tree is what moves next, then everything else in git's own order.
  const rows = mergeStashes(history, stashRows(parseStashes(stashesRaw)));
  const finalCommits = withLanes(
    status.dirty && history.length > 0
      ? [uncommittedCommit(history, status.changed), ...rows]
      : rows,
  );
  return {
    id: info.path,
    name: info.name,
    path: info.path,
    branch: status.branch || "HEAD detached",
    ahead: status.ahead,
    behind: status.behind,
    head: status.head,
    changed: status.changed,
    worktree: status.worktree,
    refsDigest: hashText(refsRaw),
    stashDigest: hashText(stashesRaw),
    commits: finalCommits,
    defaultCommitHash: history[0]?.hash ?? "",
  };
}

/**
 * Refresh. Two cheap reads decide whether anything moved on disk (branch, HEAD, dirty size,
 * working-tree digest, and a digest of every branch/remote/tag ref). When only refs moved the
 * commit objects are reused untouched; when history moved only the new commits are read.
 *
 * `force` drops only the "nothing changed" early exit — the reads and the work they cause stay
 * the same, so the refresh button costs no more than a focus probe that finds movement.
 *
 * New commits are not always newer than what is on screen: someone else pushes a branch whose
 * commits were written days ago, and `git log --all` files them by date, below rows already
 * shown. So the spliced list follows git's own order (read_log_order) instead of prepending.
 *
 * Returns null when nothing changed. `touched` lists the commits a caller should flash: new
 * arrivals, rows whose ref pills moved, and the uncommitted row when the working tree moved.
 */
export interface RefreshedRepository {
  repo: Repository;
  touched: string[];
}

export async function refreshRepository(
  repo: Repository,
  force = false,
): Promise<RefreshedRepository | null> {
  const [status, refsRaw, stashesRaw] = await Promise.all([
    readStatus(repo.path),
    readRefs(repo.path),
    readStashes(repo.path),
  ]);
  const branch = status.branch || "HEAD detached";
  const refsDigest = hashText(refsRaw);
  const stashDigest = hashText(stashesRaw);
  const stashes = stashRows(parseStashes(stashesRaw));
  const hadWip = repo.commits.some((commit) => commit.hash === UNCOMMITTED_HASH);
  const dirtyCount = status.dirty ? status.changed : 0;
  const knownDirtyCount = hadWip ? repo.changed : 0;
  // The path count stays put while a file is edited, so the tree digest does the real work.
  const worktreeMoved = status.worktree !== repo.worktree;

  if (
    !force &&
    branch === repo.branch &&
    status.head === repo.head &&
    refsDigest === repo.refsDigest &&
    stashDigest === repo.stashDigest &&
    dirtyCount === knownDirtyCount &&
    !worktreeMoved
  ) {
    return null;
  }

  const tipRefs = parseForEachRef(refsRaw, branch);
  const headMoved = status.head !== repo.head;
  // A fetch that only adds a branch leaves HEAD alone, but its commits are new to this window,
  // so the refs digest counts as movement for the delta read too.
  let fresh: Commit[] = [];

  const previousByHash = new Map(repo.commits.map((commit) => [commit.hash, commit]));

  if (headMoved || refsDigest !== repo.refsDigest) {
    try {
      const raw = await readLogDelta(repo.path, repo.head, LOG_LIMIT);
      fresh = toCommits(parseLog(raw)).map((commit) => {
        const refs = mergeRefs(commit.refs, tipRefs.get(commit.hash) ?? []);
        // The delta also repeats commits already on screen (anything not reachable from HEAD),
        // so keep the old object unless its pills really moved. Same object = no re-render.
        const previous = previousByHash.get(commit.hash);
        return previous && sameRefs(previous.refs, refs) ? previous : { ...commit, refs };
      });
      // A page cap means the window shifted, and an empty delta with a moved HEAD means history
      // was rewritten or rewound (reset, rebase); both need the full log again.
      if (fresh.length >= LOG_LIMIT || (headMoved && fresh.length === 0)) return fullReload(repo);
    } catch (deltaError) {
      // A rebase or force-push can orphan the old HEAD; the range is meaningless then.
      console.error("Could not read the new commits, reloading the repository", deltaError);
      return fullReload(repo);
    }
  }

  const touched: string[] = fresh
    .filter((commit) => previousByHash.get(commit.hash) !== commit)
    .map((commit) => commit.hash);
  // The uncommitted row is rebuilt from scratch on every refresh and never part of the log
  // delta, so it takes its flash by hand: a save in the editor is visible right away.
  if (status.dirty && (worktreeMoved || dirtyCount !== knownDirtyCount)) {
    touched.push(UNCOMMITTED_HASH);
  }
  // A stash taken (or dropped) while the window was open: dropping renumbers the entries below
  // it, so the pill moving counts as a change too, not just a new hash.
  const previousStashes = new Map(
    repo.commits.filter(isStashRow).map((commit) => [commit.hash, commit.refs[0]?.name]),
  );
  for (const stash of stashes) {
    if (previousStashes.get(stash.hash) !== stash.refs[0]?.name) touched.push(stash.hash);
  }
  const freshHashes = new Set(touched);
  const existing = repo.commits
    .filter(
      (commit) =>
        commit.hash !== UNCOMMITTED_HASH && !isStashRow(commit) && !freshHashes.has(commit.hash),
    )
    .map((commit) => {
      const refs = tipRefs.get(commit.hash) ?? [];
      if (sameRefs(commit.refs, refs)) return commit;
      touched.push(commit.hash);
      return { ...commit, refs };
    });

  // Follow git's ordering for the merged window; fall back to prepending only if it fails.
  let history: Commit[] = [...fresh, ...existing];
  if (fresh.length > 0) {
    try {
      const wanted = Math.max(repo.commits.length, LOG_LIMIT);
      const order = (await readLogOrder(repo.path, wanted))
        .split(String.fromCharCode(10))
        .map((line) => line.trim())
        .filter((line) => line !== "");
      const byHash = new Map(history.map((commit) => [commit.hash, commit]));
      const ordered: Commit[] = [];
      for (const hash of order) {
        const commit = byHash.get(hash);
        if (!commit) continue;
        ordered.push(commit);
        byHash.delete(hash);
      }
      // Anything git no longer lists in the window (paged deeper, or pushed out) keeps its old
      // relative order after the rows git does list.
      for (const commit of history) {
        const kept = byHash.get(commit.hash);
        if (kept) ordered.push(kept);
      }
      history = ordered;
    } catch (orderError) {
      console.error("Could not read the log order, keeping the merged list", orderError);
    }
  }

  const commits = [
    ...(status.dirty && history.length > 0 ? [uncommittedCommit(history, status.changed)] : []),
    ...mergeStashes(history, stashes),
  ];

  return {
    repo: {
      ...repo,
      branch,
      ahead: status.ahead,
      behind: status.behind,
      head: status.head,
      changed: status.changed,
      worktree: status.worktree,
      refsDigest,
      stashDigest,
      commits: withLanes(commits),
      defaultCommitHash:
        history.find((commit) => commit.hash === status.head)?.hash ?? repo.defaultCommitHash,
    },
    touched,
  };
}

/** Rewritten history or a shifted window: read everything again, and flash what is new. */
async function fullReload(repo: Repository): Promise<RefreshedRepository> {
  const reloaded = await loadRepository(repo.path);
  const known = new Set(repo.commits.map((commit) => commit.hash));
  return {
    repo: reloaded,
    touched: reloaded.commits
      .filter((commit) => commit.hash !== UNCOMMITTED_HASH && !known.has(commit.hash))
      .map((commit) => commit.hash),
  };
}

/** Appends the next page of history to a loaded repository, lanes re-computed over the whole list. */
export async function loadMoreCommits(
  repo: Repository,
): Promise<{ repo: Repository; done: boolean } | null> {
  // The skip counts HISTORY rows only: read_log's --skip applies to git's log, which never
  // contains stash rows — counting them made every page skip that many real commits.
  const historyCount = repo.commits.filter(
    (commit) => commit.hash !== UNCOMMITTED_HASH && !isStashRow(commit),
  ).length;
  const [parsed, refsRaw] = await Promise.all([
    parseLog(await readLog(repo.path, LOG_LIMIT, historyCount)),
    readRefs(repo.path),
  ]);
  if (parsed.length === 0) return { repo, done: true };
  const tipRefs = parseForEachRef(refsRaw, repo.branch);
  const fresh = toCommits(parsed).map((commit) => ({
    ...commit,
    refs: mergeRefs(commit.refs, tipRefs.get(commit.hash) ?? []),
  }));
  // The uncommitted row is kept as it is and stays on top; stash rows keep their spot inside
  // history — they are not pages of history, but they are not pinned either.
  const loaded = repo.commits.filter((commit) => commit.hash !== UNCOMMITTED_HASH);
  const above = repo.commits.filter((commit) => commit.hash === UNCOMMITTED_HASH);
  const list = [...above, ...loaded, ...fresh];
  const done = parsed.length < LOG_LIMIT;
  return { repo: { ...repo, refsDigest: hashText(refsRaw), commits: withLanes(list) }, done };
}

export async function pickAndLoadRepository(): Promise<Repository | null> {
  // The native folder dialog exists only in the Tauri window; browser tabs prompt for the path.
  const dir = isTauri()
    ? await pickDirectory({ directory: true, multiple: false })
    : window.prompt("Folder path of a git repository (e.g. C:/Users/you/projects/my-repo):");
  if (!dir) return null;
  return loadRepository(dir);
}

interface RawFilePayload {
  numstat: string;
  name_status: string;
  diff: string;
}

export async function checkoutBranch(dir: string, branch: string): Promise<void> {
  await call("checkout_branch", { dir, branch }, (raw) => raw as void);
}

/** Pulls the current branch, fast-forward only; a merge-shaped pull comes back as an error. */
export async function pullBranch(dir: string): Promise<string> {
  return call("pull_branch", { dir }, (raw) => raw as string);
}

/** Pushes the current branch to origin with `-u`, so the first push sets the upstream. */
export async function pushBranch(dir: string): Promise<string> {
  return call("push_branch", { dir }, (raw) => raw as string);
}

export async function loadCommitFiles(repoPath: string, hash: string): Promise<ChangedFile[]> {
  const payload = await call<RawFilePayload>(
    "read_commit_files",
    { dir: repoPath, hash },
    (raw) => raw as RawFilePayload,
  );
  return parseCommitFiles(payload);
}

interface RawImageVersion {
  url: string;
  bytes: number;
  tooLarge: boolean;
}

interface RawImageVersions {
  old: RawImageVersion | null;
  new: RawImageVersion | null;
}

/** One side of an image diff: the blob as a data URL, ready for an <img> src. */
export interface ImageVersion {
  url: string;
  bytes: number;
  tooLarge: boolean;
}

export interface ImageVersions {
  /** The parent's copy; null when the file was added (or the commit is a root). */
  previous: ImageVersion | null;
  /** The commit's copy; null when the file was deleted (the working file for "wip"). */
  current: ImageVersion | null;
}

/** Both copies of an image file change, served as data URLs by the Rust command. */
export async function loadImageVersions(
  repoPath: string,
  hash: string,
  path: string,
): Promise<ImageVersions> {
  const raw = await call<RawImageVersions>(
    "read_image_versions",
    { dir: repoPath, hash, path },
    (response) => response as RawImageVersions,
  );
  return { previous: raw.old ?? null, current: raw.new ?? null };
}

export function readStoredPaths(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(OPEN_REPOS_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function storePaths(paths: string[]): void {
  localStorage.setItem(OPEN_REPOS_KEY, JSON.stringify(paths));
}
