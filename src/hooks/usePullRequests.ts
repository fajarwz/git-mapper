import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadPullRequests } from "../data/gitLoader";
import { commitChip, pullLinkBase, pullRequestsByBranch, pullRequestsByCommit } from "../lib/pullRequests";
import {
  PullRequestsStatus,
  PullScope,
  type PullRequest,
  type PullRequestProvider,
  type Repository,
} from "../types";

/** A window focus re-reads at most this often: merged/CI state moves on the server, not in refs. */
const FOCUS_REFRESH_MS = 60_000;

export type { PullScope };

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

type Feeds = Record<PullScope, Feed>;
/** Which of an entry's two sets of lists a read belongs to; the values are the entry's keys. */
enum Target {
  Feeds = "feeds",
  Found = "found",
}

interface Entry {
  /** null until the first read answers. */
  status: PullRequestsStatus | null;
  provider: PullRequestProvider | null;
  error: string | null;
  /** The plain lists. Open is read on arrival; the others the first time they are shown. */
  [Target.Feeds]: Feeds;
  /** The text being searched for; "" means the plain lists are on show. */
  query: string;
  /** Results of that search per scope, read on demand and dropped when the text changes. */
  [Target.Found]: Feeds;
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
const EMPTY_FEEDS: Feeds = {
  [PullScope.Open]: EMPTY_FEED,
  [PullScope.Merged]: EMPTY_FEED,
  [PullScope.All]: EMPTY_FEED,
};
const EMPTY: Entry = { status: null, provider: null, error: null, feeds: EMPTY_FEEDS, query: "", found: EMPTY_FEEDS };
const SCOPES: PullScope[] = [PullScope.Open, PullScope.Merged, PullScope.All];

function merge(older: PullRequest[], page: PullRequest[]): PullRequest[] {
  // Newest-first lists shift while someone scrolls: a PR opened meanwhile pushes the last row
  // of page one onto page two, so the seam can repeat one.
  const seen = new Set(older.map((pull) => pull.number));
  return [...older, ...page.filter((pull) => !seen.has(pull.number))];
}

/**
 * The active repo's pull requests, kept per repo path so a tab switch shows the last answer at
 * once. Each scope (open, merged, all) is a list read a page at a time (`loadMore`), and a search
 * is the same lists asked with text, matched on the server across the whole repo. Re-read from
 * the first page when the refs change (a fetch or push), on window focus (throttled) and on
 * demand. Once the CLI is known to be missing, signed out or pointless for this repo the
 * automatic re-reads stop; only `reload` (the menu's Refresh) tries again.
 *
 * State lives in a ref that every write updates first, so a caller that reads straight after
 * setting something (the menu asking for a new query's page) never sees the previous value.
 */
export function usePullRequests(repo: Repository | null) {
  const path = repo !== null && !repo.sleeping ? repo.path : null;
  const refsDigest = repo?.refsDigest ?? "";
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const store = useRef(entries);
  const request = useRef<Record<string, number>>({});
  const lastRead = useRef<Record<string, { at: number; settled: boolean }>>({});

  const change = useCallback((dir: string, apply: (entry: Entry) => Entry) => {
    store.current = { ...store.current, [dir]: apply(store.current[dir] ?? EMPTY) };
    setEntries(store.current);
  }, []);

  const patchFeed = useCallback(
    (dir: string, target: Target, scope: PullScope, feedChange: Partial<Feed>, entryChange?: Partial<Entry>) => {
      change(dir, (entry) => ({
        ...entry,
        ...entryChange,
        [target]: { ...entry[target], [scope]: { ...entry[target][scope], ...feedChange } },
      }));
    },
    [change],
  );

  const run = useCallback(
    async (dir: string, scope: PullScope, more: boolean, target: Target) => {
      const entry = store.current[dir] ?? EMPTY;
      const query = target === Target.Found ? entry.query : "";
      if (target === Target.Found && query === "") return;
      const feed = entry[target][scope];
      if (more && (feed.cursor === null || feed.loadingMore || feed.loading)) return;
      const key = `${dir}\0${target}\0${scope}\0${query}`;
      const id = (request.current[key] ?? 0) + 1;
      request.current[key] = id;
      patchFeed(dir, target, scope, more ? { loadingMore: true, moreError: null } : { loading: true, moreError: null });
      // An answer for text that has since changed is for a list nobody is looking at.
      const current = () => request.current[key] === id && (target === Target.Feeds || store.current[dir]?.query === query);
      try {
        const result = await loadPullRequests(dir, scope, more ? feed.cursor : null, entry.provider, query);
        if (!current()) return;
        change(dir, (now) => {
          const old = now[target][scope];
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
            ...now,
            status: result.status,
            provider: result.provider ?? now.provider,
            error: null,
            [target]: { ...now[target], [scope]: next },
          };
        });
        // Only the plain Open list's first page speaks for whether automatic re-reads are worth it.
        if (target === Target.Feeds && scope === PullScope.Open && !more) {
          lastRead.current[dir] = { at: Date.now(), settled: result.status === PullRequestsStatus.Ok };
        }
      } catch (readError) {
        if (!current()) return;
        const message = readError instanceof Error ? readError.message : String(readError);
        if (target === Target.Feeds && scope === PullScope.Open && !more && !feed.loaded) {
          patchFeed(dir, target, scope, { loading: false }, { status: null, error: message });
          lastRead.current[dir] = { at: Date.now(), settled: true };
        } else {
          patchFeed(dir, target, scope, { loading: false, loadingMore: false, moreError: message });
        }
      }
    },
    [change, patchFeed],
  );

  /** Back to the first page of everything that has been read, plain lists and search results. */
  const refresh = useCallback(
    (dir: string) => {
      const entry = store.current[dir] ?? EMPTY;
      void run(dir, PullScope.Open, false, Target.Feeds);
      for (const scope of SCOPES) {
        if (scope !== PullScope.Open && entry.feeds[scope].loaded) void run(dir, scope, false, Target.Feeds);
        if (entry.query !== "" && entry.found[scope].loaded) void run(dir, scope, false, Target.Found);
      }
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
  // Chips come from the plain lists; a live PR wins over a finished one for the same branch.
  const byBranch = useMemo(
    () => pullRequestsByBranch(SCOPES.flatMap((scope) => entry.feeds[scope].pulls)),
    [entry.feeds],
  );
  // A commit finds its request by the hash a merge made, from every list read so far (a search's
  // too), or by the number its message names; the link base comes off any loaded request.
  const everyLoaded = useMemo(
    () => SCOPES.flatMap((scope) => [...entry.feeds[scope].pulls, ...entry.found[scope].pulls]),
    [entry.feeds, entry.found],
  );
  const byCommit = useMemo(() => pullRequestsByCommit(everyLoaded), [everyLoaded]);
  const link = useMemo(() => pullLinkBase(everyLoaded), [everyLoaded]);
  const chipFor = useCallback(
    (commit: { hash: string; subject: string; body?: string }) => commitChip(commit, byCommit, link),
    [byCommit, link],
  );
  const view = entry.query === "" ? entry.feeds : entry.found;
  const loading = SCOPES.some((scope) => entry.feeds[scope].loading || entry.found[scope].loading);

  const targetOf = (dir: string): Target => ((store.current[dir]?.query ?? "") === "" ? Target.Feeds : Target.Found);

  const reload = useCallback(() => {
    if (path !== null) refresh(path);
  }, [path, refresh]);
  /** The next page of the list on show, or its first page if that read never landed (a retry). */
  const loadMore = useCallback(
    (scope: PullScope) => {
      if (path === null) return;
      const target = targetOf(path);
      void run(path, scope, (store.current[path] ?? EMPTY)[target][scope].loaded, target);
    },
    [path, run],
  );
  /** Reads a scope's first page the first time it is shown; later shows reuse it. */
  const show = useCallback(
    (scope: PullScope) => {
      if (path === null) return;
      const target = targetOf(path);
      const feed = (store.current[path] ?? EMPTY)[target][scope];
      if (!feed.loaded && !feed.loading) void run(path, scope, false, target);
    },
    [path, run],
  );
  /** Searches for text; "" goes back to the plain lists. The new text's lists start empty. */
  const setQuery = useCallback(
    (query: string) => {
      if (path === null) return;
      if ((store.current[path]?.query ?? "") === query) return;
      change(path, (now) => ({ ...now, query, found: EMPTY_FEEDS }));
    },
    [path, change],
  );

  return {
    status: entry.status,
    provider: entry.provider,
    error: entry.error,
    loading,
    query: entry.query,
    /** The lists on show: the plain ones, or the search's results while there is a query. */
    view,
    /** The plain lists, whatever is searched: the button's count comes from Open here. */
    feeds: entry.feeds,
    byBranch,
    /** The chip for a commit row: its merge's request, else the one its message names. */
    commitChip: chipFor,
    reload,
    loadMore,
    show,
    setQuery,
  };
}

export type PullRequestsView = ReturnType<typeof usePullRequests>;
