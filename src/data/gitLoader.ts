import { invoke } from "@tauri-apps/api/core";
import { open as pickDirectory } from "@tauri-apps/plugin-dialog";
import type { ChangedFile, Commit, CommitRef, Repository } from "../types";
import { relativeDate } from "../lib/format";
import { orderRefs } from "../lib/refOrder";
import { computeLanes } from "../lib/graphLanes";
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

export const OPEN_REPOS_KEY = "git-mapper:open-repos";

interface RepoInfo {
  path: string;
  name: string;
}

interface StatusInfo {
  branch: string;
  ahead: number;
  behind: number;
  dirty: boolean;
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
  const lanes = computeLanes(parsed.map((c) => ({ hash: c.hash, parents: c.parents })));
  return parsed.map((commit, index) => ({
    hash: commit.hash,
    subject: commit.subject,
    body: commit.body,
    author: commit.author,
    authorEmail: commit.authorEmail,
    date: commit.date,
    relativeDate: relativeDate(commit.date),
    lane: lanes[index] ?? 0,
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

async function readRefs(dir: string): Promise<string> {
  return isTauri()
    ? invoke<string>("read_refs", { dir })
    : ((await devApi("read_refs", { dir })) as { text: string }).text;
}

function uncommittedCommit(commits: Commit[]): Commit {
  const head = commits[0];
  return {
    hash: UNCOMMITTED_HASH,
    subject: "Uncommitted changes",
    author: "",
    authorEmail: "",
    date: new Date().toISOString(),
    relativeDate: "now",
    lane: 0,
    parents: [head.hash],
    refs: [],
  };
}

/** Places lanes over the real commits plus, when present, the uncommitted row on top. */
function withLanes(commits: Commit[]): Commit[] {
  const lanes = computeLanes(commits.map((c) => ({ hash: c.hash, parents: c.parents })));
  return commits.map((commit, index) => ({ ...commit, lane: lanes[index] ?? 0 }));
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
      ? withLanes([uncommittedCommit(commits), ...commits])
      : commits;
  return {
    id: info.path,
    name: info.name,
    path: info.path,
    branch: status.branch || "HEAD detached",
    ahead: status.ahead,
    behind: status.behind,
    commits: finalCommits,
    defaultCommitHash: commits[0]?.hash ?? "",
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
  return { repo: { ...repo, commits: withLanes(list) }, done };
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
