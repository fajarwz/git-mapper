import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadPullRequests } from "../data/gitLoader";
import { pullRequestsByBranch } from "../lib/pullRequests";
import type { PullRequest, PullRequestProvider, PullRequestsStatus, Repository } from "../types";

/** A window focus re-reads at most this often: merged/CI state moves on the server, not in refs. */
const FOCUS_REFRESH_MS = 60_000;

export type PullScope = "open" | "all";

/** One scope's list, filled a page at a time. */
export interface Feed {
  pulls: PullRequest[];
  /** What to ask for next; null when the last page is in (or nothing was read yet). */
  cursor: string | null;
  /** Every request in the scope when the provider says (GitHub); null otherwise. */
  total: number | null;
  /** The first page has landed. */
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  /** A page read that failed, shown where the next page would load, with a retry. */
  moreError: string | null;
}

interface Entry {
  /** null until the first read answers. */
  status: PullRequestsStatus | null;
  provider: PullRequestProvider | null;
  error: string | null;
  open: Feed;
  all: Feed;
}

const EMPTY_FEED: Feed = {
  pulls: [],
  cursor: null,
  total: null,
  loaded: false,
  loading: false,
  loadingMore: false,
  moreError: null,
};
const EMPTY: Entry = { status: null, provider: null, error: null, open: EMPTY_FEED, all: EMPTY_FEED };

function merge(older: PullRequest[], page: PullRequest[]): PullRequest[] {
  // Newest-first lists shift while someone scrolls: a PR opened meanwhile pushes the last row
  // of page one onto page two, so the seam can repeat one.
  const seen = new Set(older.map((pull) => pull.number));
  return [...older, ...page.filter((pull) => !seen.has(pull.number))];
}

/**
 * The active repo's pull requests, kept per repo path so a tab switch shows the last answer at
 * once. The Open list is read on arrival, the All list the first time it is asked for, and each
 * grows a page at a time (`loadMore`). Re-read from the first page when the refs change (a fetch
 * or push), on window focus (throttled) and on demand. Once the CLI is known to be missing,
 * signed out or pointless for this repo the automatic re-reads stop; only `reload` (the menu's
 * Refresh) tries again.
 */
export function usePullRequests(repo: Repository | null) {
  const path = repo !== null && !repo.sleeping ? repo.path : null;
  const refsDigest = repo?.refsDigest ?? "";
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const latest = useRef(entries);
  const request = useRef<Record<string, number>>({});
  const lastRead = useRef<Record<string, { at: number; settled: boolean }>>({});

  useEffect(() => {
    latest.current = entries;
  }, [entries]);

  const patch = useCallback((dir: string, scope: PullScope, change: Partial<Feed>, entry?: Partial<Entry>) => {
    setEntries((prev) => {
      const base = prev[dir] ?? EMPTY;
      return { ...prev, [dir]: { ...base, ...entry, [scope]: { ...base[scope], ...change } } };
    });
  }, []);

  const run = useCallback(
    async (dir: string, scope: PullScope, more: boolean) => {
      const entry = latest.current[dir] ?? EMPTY;
      const feed = entry[scope];
      if (more && (feed.cursor === null || feed.loadingMore || feed.loading)) return;
      const key = `${dir}\0${scope}`;
      const id = (request.current[key] ?? 0) + 1;
      request.current[key] = id;
      patch(dir, scope, more ? { loadingMore: true, moreError: null } : { loading: true, moreError: null });
      try {
        const result = await loadPullRequests(dir, scope, more ? feed.cursor : null, entry.provider);
        if (request.current[key] !== id) return;
        setEntries((prev) => {
          const base = prev[dir] ?? EMPTY;
          const old = base[scope];
          const next: Feed = {
            pulls: more ? merge(old.pulls, result.pullRequests) : result.pullRequests,
            cursor: result.nextCursor,
            total: result.total ?? (more ? old.total : null),
            loaded: true,
            loading: false,
            loadingMore: false,
            moreError: null,
          };
          return {
            ...prev,
            [dir]: { ...base, status: result.status, provider: result.provider ?? base.provider, error: null, [scope]: next },
          };
        });
        // Only the Open read's first page speaks for whether automatic re-reads are worth it.
        if (scope === "open" && !more) lastRead.current[dir] = { at: Date.now(), settled: result.status === "ok" };
      } catch (readError) {
        if (request.current[key] !== id) return;
        const message = readError instanceof Error ? readError.message : String(readError);
        if (scope === "open" && !more && !feed.loaded) {
          patch(dir, scope, { loading: false }, { status: null, error: message });
          lastRead.current[dir] = { at: Date.now(), settled: true };
        } else {
          patch(dir, scope, { loading: false, loadingMore: false, moreError: message });
          if (scope === "open" && !more) lastRead.current[dir] = { at: Date.now(), settled: true };
        }
      }
    },
    [patch],
  );

  const refresh = useCallback(
    (dir: string) => {
      void run(dir, "open", false);
      if (latest.current[dir]?.all.loaded) void run(dir, "all", false);
    },
    [run],
  );

  useEffect(() => {
    if (path === null) return;
    const seen = lastRead.current[path];
    if (seen === undefined || seen.settled) refresh(path);
  }, [path, refsDigest, refresh]);

  useEffect(() => {
    if (path === null) return;
    const onFocus = () => {
      const seen = lastRead.current[path];
      if (seen !== undefined && seen.settled && Date.now() - seen.at >= FOCUS_REFRESH_MS) refresh(path);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [path, refresh]);

  const entry = (path !== null ? entries[path] : undefined) ?? EMPTY;
  // Chips come from whatever has loaded; a live PR wins over a finished one for the same branch.
  const byBranch = useMemo(
    () => pullRequestsByBranch([...entry.open.pulls, ...entry.all.pulls]),
    [entry.open.pulls, entry.all.pulls],
  );
  const reload = useCallback(() => {
    if (path !== null) refresh(path);
  }, [path, refresh]);
  /** The next page of a scope, or its first page if that read never landed (a retry). */
  const loadMore = useCallback(
    (scope: PullScope) => {
      if (path === null) return;
      const feed = (latest.current[path] ?? EMPTY)[scope];
      void run(path, scope, feed.loaded);
    },
    [path, run],
  );
  /** Reads All's first page the first time the tab is opened; later opens reuse it. */
  const showAll = useCallback(() => {
    if (path === null) return;
    const feed = (latest.current[path] ?? EMPTY).all;
    if (!feed.loaded && !feed.loading) void run(path, "all", false);
  }, [path, run]);

  return {
    status: entry.status,
    provider: entry.provider,
    error: entry.error,
    loading: entry.open.loading || entry.all.loading,
    open: entry.open,
    all: entry.all,
    byBranch,
    reload,
    loadMore,
    showAll,
  };
}

export type PullRequestsView = ReturnType<typeof usePullRequests>;
