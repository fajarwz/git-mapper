import { invoke } from "@tauri-apps/api/core";
import { open as pickDirectory } from "@tauri-apps/plugin-dialog";
import type { ChangedFile, Commit, CommitRef, Repository } from "../types";
import { STORAGE_KEYS } from "../lib/persisted";
import { orderRefs } from "../lib/refOrder";
import { layoutGraph } from "../lib/graphLanes";
import { parseCommitFiles } from "../lib/gitDiffParser";
import { parseLog } from "../lib/gitLogParser";

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

/** Dogfood target for the very first run, when no repository has been opened before. */
export const FIRST_RUN_PATH = "C:/DATA/lab/tauri/git-mapper";

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
}

/** Cheap, stable digest: we only ever compare ref snapshots for equality. */
function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

/** Decoration refs first, then for-each-ref tips not already present (dedupe by type+name). */
function mergeRefs(decorations: CommitRef[], tips: CommitRef[]): CommitRef[] {
  return orderRefs([
    ...decorations,
    ...tips.filter(
      (tip) => !decorations.some((d) => d.type === tip.type && d.name === tip.name),
    ),
  ]);
}

function toCommits(parsed: ReturnType<typeof parseLog>): Commit[] {
  const layout = layoutGraph(parsed.map((c) => ({ hash: c.hash, parents: c.parents })));
  return parsed.map((commit, index) => ({
    hash: commit.hash,
    subject: commit.subject,
    body: commit.body,
    author: commit.author,
    authorEmail: commit.authorEmail,
    date: commit.date,
    lane: layout.lanes[index] ?? 0,
    color: layout.colors.get(commit.hash) ?? layout.lanes[index] ?? 0,
    parents: commit.parents,
    refs: commit.refs,
  }));
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
  return byHash;
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

function uncommittedCommit(commits: Commit[], changed: number): Commit {
  const head = commits[0];
  return {
    hash: UNCOMMITTED_HASH,
    subject: changed > 0 ? `Uncommitted changes (${changed})` : "Uncommitted changes",
    author: "",
    authorEmail: "",
    date: new Date().toISOString(),
    lane: 0,
    color: 0,
    parents: [head.hash],
    refs: [],
  };
}

/** Places lanes over the real commits plus, when present, the uncommitted row on top. */
function withLanes(commits: Commit[]): Commit[] {
  const layout = layoutGraph(commits.map((c) => ({ hash: c.hash, parents: c.parents })));
  // Reuse the commit object when its lane and colour are unchanged: rows are memoized, so
  // identical objects mean identical renders and no DOM work for history that did not move.
  return commits.map((commit, index) => {
    const lane = layout.lanes[index] ?? 0;
    const color = layout.colors.get(commit.hash) ?? lane;
    return commit.lane === lane && commit.color === color ? commit : { ...commit, lane, color };
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
  const [status, log, refsRaw] = await Promise.all([
    call<StatusInfo>("read_status", { dir: info.path }, (raw) => raw as StatusInfo),
    readLog(info.path, LOG_LIMIT, 0),
    readRefs(info.path),
  ]);
  const tipRefs = parseForEachRef(refsRaw, status.branch || "");
  const commits = toCommits(parseLog(log)).map((commit) => ({
    ...commit,
    refs: mergeRefs(commit.refs, tipRefs.get(commit.hash) ?? []),
  }));
  const finalCommits =
    status.dirty && commits.length > 0
      ? withLanes([uncommittedCommit(commits, status.changed), ...commits])
      : commits;
  return {
    id: info.path,
    name: info.name,
    path: info.path,
    branch: status.branch || "HEAD detached",
    ahead: status.ahead,
    behind: status.behind,
    head: status.head,
    changed: status.changed,
    refsDigest: hashText(refsRaw),
    commits: finalCommits,
    defaultCommitHash: commits[0]?.hash ?? "",
  };
}

/**
 * Focus refresh. Two cheap reads decide whether anything moved on disk (branch, HEAD, dirty
 * size, and a digest of every branch/remote/tag ref). When only refs moved the commit objects
 * are reused untouched; when history moved only the new commits are read.
 *
 * New commits are not always newer than what is on screen: someone else pushes a branch whose
 * commits were written days ago, and `git log --all` files them by date, below rows already
 * shown. So the spliced list follows git's own order (read_log_order) instead of prepending.
 *
 * Returns null when nothing changed. `touched` lists the commits a caller should flash: new
 * arrivals and rows whose ref pills moved.
 */
export interface RefreshedRepository {
  repo: Repository;
  touched: string[];
}

export async function refreshRepository(repo: Repository): Promise<RefreshedRepository | null> {
  const [status, refsRaw] = await Promise.all([readStatus(repo.path), readRefs(repo.path)]);
  const branch = status.branch || "HEAD detached";
  const refsDigest = hashText(refsRaw);
  const hadWip = repo.commits.some((commit) => commit.hash === UNCOMMITTED_HASH);
  const dirtyCount = status.dirty ? status.changed : 0;
  const knownDirtyCount = hadWip ? repo.changed : 0;

  if (
    branch === repo.branch &&
    status.head === repo.head &&
    refsDigest === repo.refsDigest &&
    dirtyCount === knownDirtyCount
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
  const freshHashes = new Set(touched);
  const existing = repo.commits
    .filter((commit) => commit.hash !== UNCOMMITTED_HASH && !freshHashes.has(commit.hash))
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

  const commits = status.dirty
    ? [uncommittedCommit(history, status.changed), ...history]
    : history;

  return {
    repo: {
      ...repo,
      branch,
      ahead: status.ahead,
      behind: status.behind,
      head: status.head,
      changed: status.changed,
      refsDigest,
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
  const loaded = repo.commits.filter((commit) => commit.hash !== UNCOMMITTED_HASH);
  const [parsed, refsRaw] = await Promise.all([
    parseLog(await readLog(repo.path, LOG_LIMIT, loaded.length)),
    readRefs(repo.path),
  ]);
  if (parsed.length === 0) return { repo, done: true };
  const tipRefs = parseForEachRef(refsRaw, repo.branch);
  const fresh = toCommits(parsed).map((commit) => ({
    ...commit,
    refs: mergeRefs(commit.refs, tipRefs.get(commit.hash) ?? []),
  }));
  const wip = repo.commits.find((commit) => commit.hash === UNCOMMITTED_HASH) ?? null;
  const list = (wip ? [wip, ...loaded, ...fresh] : [...loaded, ...fresh]);
  const done = parsed.length < LOG_LIMIT;
  return { repo: { ...repo, refsDigest: hashText(refsRaw), commits: withLanes(list) }, done };
}

export async function pickAndLoadRepository(): Promise<Repository | null> {
  // The native folder dialog exists only in the Tauri window; browser tabs prompt for the path.
  const dir = isTauri()
    ? await pickDirectory({ directory: true, multiple: false })
    : window.prompt("Folder path of a git repository (e.g. C:/DATA/lab/tauri/git-mapper):");
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

export async function loadCommitFiles(repoPath: string, hash: string): Promise<ChangedFile[]> {
  const payload = await call<RawFilePayload>(
    "read_commit_files",
    { dir: repoPath, hash },
    (raw) => raw as RawFilePayload,
  );
  return parseCommitFiles(payload);
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
