import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadPullRequests } from "../data/gitLoader";
import { pullRequestsByBranch } from "../lib/pullRequests";
import type { PullRequest, PullRequestsStatus, Repository } from "../types";

/** A window focus re-reads at most this often: merged/CI state moves on the server, not in refs. */
const FOCUS_REFRESH_MS = 60_000;

interface Entry {
  /** null until the first read answers. */
  status: PullRequestsStatus | null;
  pulls: PullRequest[];
  loading: boolean;
  error: string | null;
}

const EMPTY: Entry = { status: null, pulls: [], loading: false, error: null };

/**
 * The active repo's pull requests, kept per repo path so a tab switch shows the last answer
 * at once. Re-read when the refs change (a fetch or push), on window focus (throttled) and on
 * demand. Once gh is known to be missing, signed out or pointless for this repo the automatic
 * re-reads stop; only `reload` (the menu's "Check again") tries again.
 */
export function usePullRequests(repo: Repository | null) {
  const path = repo !== null && !repo.sleeping ? repo.path : null;
  const refsDigest = repo?.refsDigest ?? "";
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const request = useRef<Record<string, number>>({});
  const lastRead = useRef<Record<string, { at: number; settled: boolean }>>({});

  const load = useCallback(async (dir: string) => {
    const id = (request.current[dir] ?? 0) + 1;
    request.current[dir] = id;
    setEntries((prev) => ({ ...prev, [dir]: { ...(prev[dir] ?? EMPTY), loading: true } }));
    let next: Entry;
    try {
      const result = await loadPullRequests(dir);
      next = { status: result.status, pulls: result.pullRequests, loading: false, error: null };
    } catch (readError) {
      next = {
        status: null,
        pulls: [],
        loading: false,
        error: readError instanceof Error ? readError.message : String(readError),
      };
    }
    if (request.current[dir] !== id) return;
    // A real answer or a failure may be retried automatically; a "can't work here" may not.
    lastRead.current[dir] = { at: Date.now(), settled: next.status === "ok" || next.error !== null };
    setEntries((prev) => ({ ...prev, [dir]: next }));
  }, []);

  useEffect(() => {
    if (path === null) return;
    const seen = lastRead.current[path];
    if (seen === undefined || seen.settled) void load(path);
  }, [path, refsDigest, load]);

  useEffect(() => {
    if (path === null) return;
    const onFocus = () => {
      const seen = lastRead.current[path];
      if (seen !== undefined && seen.settled && Date.now() - seen.at >= FOCUS_REFRESH_MS) void load(path);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [path, load]);

  const entry = (path !== null ? entries[path] : undefined) ?? EMPTY;
  const byBranch = useMemo(() => pullRequestsByBranch(entry.pulls), [entry.pulls]);
  const reload = useCallback(() => {
    if (path !== null) void load(path);
  }, [path, load]);

  return { ...entry, byBranch, reload };
}

export type PullRequestsView = ReturnType<typeof usePullRequests>;
