import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CSSProperties } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { BootScreen } from "./components/BootScreen";
import { CommitList } from "./components/CommitList";
import { ContextMenu, type ContextMenuTarget, type StashAction } from "./components/ContextMenu";
import { DetailsPanel } from "./components/DetailsPanel";
import type { DiffLayout, DiffScope } from "./components/DiffViewer";
import { EmptyState } from "./components/EmptyState";
import { TitleBar } from "./components/TitleBar";
import { Toast } from "./components/Toast";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SettingsModal } from "./components/SettingsModal";
import { STORAGE_KEYS, usePersistedState } from "./lib/persisted";
import { filterCommits } from "./lib/commitFilter";
import type { SyntaxScheme } from "./lib/highlight";
import {
  checkForUpdates,
  downloadUpdate,
  onUpdateStatus,
  restartToUpdate,
  updateStatusSnapshot,
  type UpdateMode,
  type UpdateStatus,
} from "./lib/updater";
import { applyTheme, initialTheme, storeTheme } from "./lib/theme";
import type { Theme } from "./lib/theme";
import { checkoutBranch,
  checkoutCommit,
  fetchRemote,
  loadConflictFiles,
  writeConflictResolution,
  loadMoreCommits,
  loadRepository,
  mergeBranch,
  pickAndLoadRepository,
  pullBranch,
  pushBranch,
  readStoredPaths,
  refreshRepository,
  resolveConflictSides,
  abortMerge,
  completeMerge,
  stashAction,
  undoCommit,
  UNCOMMITTED_HASH,
  SLEEP_AFTER_MS,
  SLEEP_TICK_MS,
  storePaths,
  commitStaged,
  discardEverything,
  discardPaths,
  loadWorktree,
  stagePaths,
  unstagePaths,
  applyHunk,
  type ConflictSnapshot,
  type HunkAction,
} from "./data/gitLoader";
import {
  DEFAULT_STAGE_WIDTH,
  MAX_STAGE_WIDTH,
  MIN_STAGE_WIDTH,
  StagePanel,
} from "./components/StagePanel";
import { ResizeHandle } from "./components/ResizeHandle";
import type { WorktreeFile } from "./lib/staging";
import type { Repository } from "./types";
import { useCommitFiles } from "./hooks/useCommitFiles";
import { useWipSide } from "./hooks/useWipSide";

/** Auto-fetch window on refocus — often enough to notice a push, rare enough to stay quiet. */
const FETCH_ON_FOCUS_MS = 180_000;

function App() {
  const [repos, setRepos] = useState<Repository[]>([]);
  // Launch with saved tabs means there is real work to wait for, and the read is synchronous so
  // the decision exists before the first paint. Without this flag App has no repository yet and
  // renders the open-folder card for the length of the first git read — which reads as "nothing
  // is saved". A fresh install has nothing to hydrate, so it goes straight to that card.
  const [booting, setBooting] = useState(() => readStoredPaths().length > 0);
  // Restored on launch: which tab was open, which commit/file was being read, panel state.
  const [activeRepoId, setActiveRepoId] = usePersistedState<string | null>(STORAGE_KEYS.activeRepo, null);
  const [selectedCommitByRepo, setSelectedCommitByRepo] = usePersistedState<Record<string, string>>(
    STORAGE_KEYS.selectedCommits,
    {},
  );
  // null means "fall back to the first changed file", which is what a fresh commit selection wants.
  const [selectedFileByRepo, setSelectedFileByRepo] = usePersistedState<Record<string, string | null>>(
    STORAGE_KEYS.selectedFiles,
    {},
  );
  const [loadingMoreByRepo, setLoadingMoreByRepo] = useState<Record<string, boolean>>({});
  const [allLoadedByRepo, setAllLoadedByRepo] = useState<Record<string, boolean>>({});
  const [opening, setOpening] = useState(false);
  // The sleeping tab being reloaded right now (its history was dropped; see the sleep timer).
  const [wakingId, setWakingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // One transient failure notice (a toast, bottom-right): opening a non-git folder, a failed
  // checkout, saved tabs that no longer open. `id` re-keys the toast so a new failure restarts
  // its auto-dismiss timer.
  const [notice, setNotice] = useState<{ title: string; detail: string; id: number } | null>(null);

  // Bottom panel: closable, and its height is draggable (null = the default percentage).
  const [detailsOpen, setDetailsOpen] = usePersistedState(STORAGE_KEYS.detailsOpen, true);
  const [detailsHeight, setDetailsHeight] = usePersistedState<number | null>(
    STORAGE_KEYS.detailsHeight,
    null,
  );
  // Diff token palette: app tokens, GitHub's look, or One-Dark neon. Colours are the default.
  const [syntaxScheme, setSyntaxScheme] = usePersistedState<SyntaxScheme>(
    STORAGE_KEYS.syntaxScheme,
    "app",
  );
  // Diff pane scope: one file at a time (the default) or every file in one scroll. Persisted,
  // because a reader who prefers the stacked view wants it on every launch.
  const [diffScope, setDiffScope] = usePersistedState<DiffScope>(STORAGE_KEYS.diffScope, "file");
  // Diff line layout: unified column (the default) or GitHub's side-by-side split.
  const [diffLayout, setDiffLayout] = usePersistedState<DiffLayout>(STORAGE_KEYS.diffLayout, "unified");
  // Long lines soft-wrap (the pane is narrow); the wrap toggle switches back to horizontal scroll.
  const [diffWrap, setDiffWrap] = usePersistedState<boolean>(STORAGE_KEYS.diffWrap, true);
  // The initials avatar beside the username in the commit list; git itself has no picture.
  const [showAvatars, setShowAvatars] = usePersistedState<boolean>(STORAGE_KEYS.showAvatars, true);

  // Updates: auto (background download on launch) by default, manual as the opt-out.
  const [updateMode, setUpdateMode] = usePersistedState<UpdateMode>(STORAGE_KEYS.updateMode, "auto");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(updateStatusSnapshot());
  const [appVersion, setAppVersion] = useState("");

  // The staging rail, wired to real git: the rows are a read of the worktree reload on every
  // digest move, and per-repo map persists which tab has the rail docked open. Unset + dirty
  // means open by default — a launch into work starts at the work.
  const [worktreeFiles, setWorktreeFiles] = useState<WorktreeFile[]>([]);
  const [stageDrawerByRepo, setStageDrawerByRepo] = usePersistedState<Record<string, boolean>>(
    STORAGE_KEYS.stageDrawer,
    {},
  );
  // True while one of the rail's git writes is in flight; the panel's buttons all wait.
  const [stagingBusy, setStagingBusy] = useState(false);
  // The conflict view: which unmerged path the rail summoned, with both sides' patches.
  // null kills it — switching tab, picking another commit, or the path resolving away.
  const [conflictView, setConflictView] = useState<{ path: string; snapshot: ConflictSnapshot } | null>(null);
  // Rail width: a pinned px value survives restarts (like the details height); null stays on
  // the tuned default. The drag pinning an ABSOLUTE width matters here too — never an offset.
  const [stageWidth, setStageWidth] = usePersistedState<number | null>(STORAGE_KEYS.stageWidth, null);

  // Rows a refresh just added or re-pilled, highlighted for a moment then forgotten.
  const [flashHashes, setFlashHashes] = useState<string[]>([]);
  // Right-click menu: what was clicked (position, commit, ref). null = closed.
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  // Search over the loaded window: hashes, subjects, authors, ref pills. Not synced per tab —
  // switching repos clears it, because a filter carried into another tab would look like a bug.
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // The updater store lives module-level; App just mirrors its status into state.
  useEffect(() => onUpdateStatus(setUpdateStatus), []);

  // The release version, for the settings about line.
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("dev"));
  }, []);

  // Auto mode checks on launch (and when the mode is switched back to auto). Dev builds skip:
  // they are unsigned, so a real check would only ever error.
  useEffect(() => {
    if (updateMode === "auto" && !import.meta.env.DEV) void checkForUpdates("auto");
  }, [updateMode]);

  const handleCheckForUpdates = useCallback(() => {
    void checkForUpdates("manual");
  }, []);
  const handleDownloadUpdate = useCallback(() => {
    void downloadUpdate();
  }, []);
  const handleRestartToUpdate = useCallback(() => {
    void restartToUpdate();
  }, []);

  const hydratedPaths = useRef(false);

  // First paint loads the persisted tabs; a fresh install starts on the empty state, so no
  // machine-specific path is baked into the build. `booting` holds the launch screen until the
  // loop lands, and clears on every exit path — including "every stored path failed to open",
  // which must fall through to the empty state rather than spin forever.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = readStoredPaths();
      // Parallel on purpose: hydration is nothing but git reads, and the read time
      // per tab dominates cold start with several tabs, so this wait is the max of
      // the per-tab loads, not their sum. Paths stay in stored order via index.
      const results = await Promise.allSettled(stored.map((path) => loadRepository(path)));
      const loaded: Repository[] = [];
      const failed: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          loaded.push(result.value);
        } else {
          failed.push(stored[index]);
          console.error(`Could not open ${stored[index]}`, result.reason);
        }
      });
      if (cancelled) return;
      hydratedPaths.current = true;
      setRepos(loaded);
      // A saved tab whose folder stopped being a repository must not vanish silently.
      if (failed.length > 0) {
        setNotice({
          title:
            failed.length === 1
              ? "A saved repository could not be reopened"
              : "Some saved repositories could not be reopened",
          detail: failed.join("\n"),
          id: Date.now(),
        });
      }
      const restored = loaded.some((item) => item.id === activeRepoId) ? activeRepoId : null;
      setActiveRepoId(restored ?? loaded[0]?.id ?? null);
      // The tab this launch shows catches up with its remotes once, right away: an opened
      // app should speak for the network's state, not for whatever the last session fetched.
      const shown =
        restored !== null ? loaded.find((item) => item.id === restored) : (loaded[0] ?? null);
      if (shown) void fetchAndRefresh(shown);
    })()
      .catch((loadError) => {
        console.error("Could not restore the open repositories", loadError);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the open tab list; the data itself is reloaded on launch.
  // Skipped until the first load lands: React calls this with an empty list on mount,
  // which would otherwise wipe the stored paths before they are read back.
  useEffect(() => {
    if (!hydratedPaths.current) return;
    storePaths(repos.map((repo) => repo.path));
  }, [repos]);

  const repo = useMemo(
    () => repos.find((item) => item.id === activeRepoId) ?? null,
    [repos, activeRepoId],
  );
  const activeRepoPath = repo?.path ?? null;

  // During a merge the conflicted paths live in the rail's Conflicts section — the plain
  // Staged/Changes sections must not echo them as ordinary modified rows.
  const railFiles = useMemo(() => {
    const conflicted = new Set(repo?.conflicts ?? []);
    return worktreeFiles.filter((file) => !conflicted.has(file.path));
  }, [worktreeFiles, repo]);

  // The staging rail's dock state: per-repo persisted, falling back to open while the
  // worktree has changes (a repo opened dirty starts with its rail up).
  const stageOpen = repo ? (stageDrawerByRepo[repo.id] ?? worktreeFiles.length > 0) : false;
  const setStageOpen = useCallback(
    (open: boolean) => {
      if (!activeRepoId) return;
      setStageDrawerByRepo((previous) => ({ ...previous, [activeRepoId]: open }));
    },
    [activeRepoId, setStageDrawerByRepo],
  );

  // The commit whose payload the details panel reads (persisted per repo, default HEAD).
  const selectedCommit = repo
    ? (repo.commits.find(
        (commit) => commit.hash === (selectedCommitByRepo[repo.id] ?? repo.defaultCommitHash),
      ) ?? repo.commits[0] ?? null)
    : null;

  // Docking is owned by the handlers (a commit or a discard-all close the burst), the user's
  // exits (×, Esc, swipe), and the emptied-transition below the staging dispatcher.
  const selectedFilePath = selectedFileByRepo[repo?.id ?? ""] ?? null;
  const {
    files,
    selectedFile,
    filesLoading,
    handlePatchNeeded,
    evictRepoFiles,
  } = useCommitFiles({ repo, selectedCommit, selectedFilePath });
  // The uncommitted row shows one side at a time (staged / working tree) with hunk buttons.
  const isWipSelected = selectedCommit?.hash === UNCOMMITTED_HASH;
  const wipSide = useWipSide({
    repoPath: repo?.path ?? null,
    active: isWipSelected && detailsOpen && !conflictView,
    rows: railFiles,
    hiddenPaths: repo?.conflicts,
    digest: repo?.worktree,
    selectedFilePath,
  });

  const handleSelectRepo = useCallback(
    (id: string) => {
      setActiveRepoId(id);
      setQuery("");
      const target = repos.find((item) => item.id === id);
      if (!target?.sleeping) return;
      setWakingId(id);
      loadRepository(target.path)
        .then((loaded) => {
          setRepos((previous) =>
            previous.map((item) => (item.id === loaded.id ? loaded : item)),
          );
          void fetchAndRefresh(loaded);
        })
        .catch((wakeError) => {
          console.error("Could not wake the repository", wakeError);
          setNotice({
            title: "Could not reopen that repository",
            detail: wakeError instanceof Error ? wakeError.message : String(wakeError),
            id: Date.now(),
          });
        })
        .finally(() => setWakingId((current) => (current === id ? null : current)));
    },
    [repos],
  );

  // Tab order is the order of this array, so a drag is just a splice; the persist effect
  // stores the new order straight after.
  const handleReorderRepos = useCallback((from: number, to: number) => {
    setRepos((previous) => {
      if (from === to || from < 0 || to < 0 || from >= previous.length || to >= previous.length) {
        return previous;
      }
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  async function handleAdd() {
    setOpening(true);
    try {
      const opened = await pickAndLoadRepository();
      if (!opened) return;
      setRepos((previous) =>
        previous.some((item) => item.path === opened.path) ? previous : [...previous, opened],
      );
      setActiveRepoId(opened.id);
      void fetchAndRefresh(opened);
    } catch (openError) {
      setNotice({
        title: "Could not open that folder",
        detail: openError instanceof Error ? openError.message : String(openError),
        id: Date.now(),
      });
    } finally {
      setOpening(false);
    }
  }

  function handleCloseRepo(id: string) {
    const closed = repos.find((item) => item.id === id);
    if (closed) evictRepoFiles(closed.path);
    setRepos((previous) => {
      const next = previous.filter((item) => item.id !== id);
      if (id === activeRepoId) {
        setActiveRepoId(next[next.length - 1]?.id ?? null);
      }
      return next;
    });
  }

  const handleSelectCommit = useCallback((hash: string) => {
    if (!activeRepoId) return;
    setSelectedCommitByRepo((previous) => ({ ...previous, [activeRepoId]: hash }));
    setSelectedFileByRepo((previous) => ({ ...previous, [activeRepoId]: null }));
    setConflictView(null);
    wipSide.pickSide(null);
    // Picking a commit is a request to read it, so bring the details panel back if it was closed.
    setDetailsOpen(true);
    // The uncommitted row is the rail's second door: it summons the staging state together
    // with its diff; a real commit dock it away — the rail is burst work, not a fixture.
    setStageOpen(hash === UNCOMMITTED_HASH);
    }, [activeRepoId, setDetailsOpen, setSelectedCommitByRepo, setSelectedFileByRepo, setStageOpen, wipSide.pickSide]);

    // A rail-row click reads that file: the uncommitted row is selected and the details panel
    // rises. The diff scope stays — the reader's preference; the stacked view scrolls to it.
    const handleRailSelectFile = useCallback(
      (file: WorktreeFile) => {
        if (!activeRepoId) return;
        setSelectedCommitByRepo((previous) => ({ ...previous, [activeRepoId]: UNCOMMITTED_HASH }));
        setSelectedFileByRepo((previous) => ({ ...previous, [activeRepoId]: file.path }));
        setConflictView(null);
        wipSide.pickSide(file.staged ? "staged" : "unstaged");
        setDetailsOpen(true);
      },
      [activeRepoId, setSelectedCommitByRepo, setSelectedFileByRepo, setDetailsOpen, wipSide.pickSide],
    );

  const handleSelectFile = useCallback((path: string) => {
    if (!activeRepoId) return;
    setSelectedFileByRepo((previous) => ({ ...previous, [activeRepoId]: path }));
  }, [activeRepoId, setSelectedFileByRepo]);

  // Infinite scroll: the commit rows file a near-bottom signal, one page loads at a time.
  // Double-clicking a branch pill checks the branch out and reloads the repo.
  const handleCheckoutBranch = useCallback(async (branch: string) => {
    if (!activeRepoPath || opening) return;
    try {
      await checkoutBranch(activeRepoPath, branch);
      const refreshed = await loadRepository(activeRepoPath);
      setRepos((previous) =>
        previous.map((item) => (item.id === refreshed.id ? refreshed : item)),
      );
    } catch (checkoutError) {
      setNotice({
        title: `Could not check out ${branch}`,
        detail: checkoutError instanceof Error ? checkoutError.message : String(checkoutError),
        id: Date.now(),
      });
    }
  }, [activeRepoPath, opening]);

  async function handleNearBottom() {
    // While a search filters the list the scrolled window no longer maps to pages: the
    // "load more" trigger stays off until the query is cleared.
    if (!repo || query || loadingMoreByRepo[repo.id] || allLoadedByRepo[repo.id]) return;
    setLoadingMoreByRepo((previous) => ({ ...previous, [repo.id]: true }));
    try {
      const result = await loadMoreCommits(repo);
      if (result) {
        setRepos((previous) =>
          previous.map((item) => (item.id === result.repo.id ? result.repo : item)),
        );
        if (result.done) setAllLoadedByRepo((previous) => ({ ...previous, [repo.id]: true }));
      }
    } catch (pageError) {
      console.error("Could not load more history", pageError);
    } finally {
      setLoadingMoreByRepo((previous) => ({ ...previous, [repo.id]: false }));
    }
  }

  // Rows a refresh just touched land here. Clearing first is what restarts the CSS animation
  // when the same hash flashes twice in a row — saving, looking, saving again while the wash is
  // still fading. The class has to leave the DOM for an animation to start over.
  const showFlash = useCallback((hashes: string[]) => {
    if (hashes.length === 0) return;
    setFlashHashes([]);
    window.requestAnimationFrame(() => setFlashHashes(hashes));
  }, []);

  // Merging a branch lands through the rail: a clean merge refreshes and flashes the new tip,
  // a conflicted one opens the rail and the resolver takes over from there.
  const handleMergeBranch = useCallback(
    (branch: string) => {
      if (!activeRepoPath || !repo) return;
      setPendingConfirm({
        title: `Merge ${branch} into ${repo.branch}?`,
        body: (
          <p>
            A clean merge lands quietly. With conflicts, the staging rail opens its resolver:
            take a side for each file, then complete the merge.
          </p>
        ),
        confirmLabel: "Merge",
        run: async () => {
          try {
            const outcome = await mergeBranch(activeRepoPath, branch);
            const refreshed = await loadRepository(activeRepoPath);
            setRepos((previous) =>
              previous.map((item) => (item.id === refreshed.id ? refreshed : item)),
            );
            if (outcome.merged) {
              showFlash(refreshed.commits.slice(-1).map((commit) => commit.hash));
            } else {
              setStageOpen(true);
              setNotice({
                title: `Merging ${branch} conflicts`,
                detail:
                  "Take a side for each conflicted file in the staging rail, then complete the merge.",
                id: Date.now(),
              });
            }
          } catch (mergeError) {
            setNotice({
              title: `Could not merge ${branch}`,
              detail: mergeError instanceof Error ? mergeError.message : String(mergeError),
              id: Date.now(),
            });
          }
        },
      });
    },
    [activeRepoPath, repo, showFlash, setStageOpen],
  );

  // Opening a repository — or refocusing the app — quietly pulls every remote into the
  // tracking refs first: the ahead/behind counts and the pills only describe the network's
  // state after a fetch. A failed fetch is offline, not a toast: the local state is already
  // live, and the remote view catches up on a later fetch. The local refresh that follows
  // runs forced — refs the fetch moved (even without any HEAD move) must splice their commits.
  const lastFetchStamp = useRef(0);
  // Returns whether the fetch itself succeeded: the auto paths only refresh, the manual
  // button uses it to say "the remotes did not respond" before silently keeping the view.
  const fetchAndRefresh = useCallback(
    async (target: Repository): Promise<boolean> => {
      let fetched = false;
      try {
        await fetchRemote(target.path);
        fetched = true;
      } catch (fetchError) {
        console.debug("Could not fetch remotes", fetchError);
      }
      const refreshed = await refreshRepository(target, true);
      if (!refreshed) return fetched;
      setRepos((previous) =>
        previous.map((item) => (item.id === refreshed.repo.id ? refreshed.repo : item)),
      );
      showFlash(refreshed.touched);
      return fetched;
    },
    [showFlash],
  );

  // Pull / push the checked-out branch, then force a refresh so the counters and the window
  // follow. A failed sync tints its button for a moment — the message is on the tooltip.
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<{ op: "pull" | "push"; message: string } | null>(null);
  const syncErrorTimer = useRef(0);

  const runSync = useCallback(
    async (op: "pull" | "push") => {
      if (!repo || !activeRepoPath || syncing || repo.branch === "HEAD detached") return;
      setSyncing(true);
      setSyncError(null);
      try {
        if (op === "pull") await pullBranch(activeRepoPath);
        else await pushBranch(activeRepoPath);
        const refreshed = await refreshRepository(repo, true);
        if (refreshed) {
          setRepos((previous) =>
            previous.map((item) => (item.id === refreshed.repo.id ? refreshed.repo : item)),
          );
          showFlash(refreshed.touched);
        }
      } catch (syncFailure) {
        const message = syncFailure instanceof Error ? syncFailure.message : String(syncFailure);
        console.error(`Could not ${op} ${repo.branch}`, syncFailure);
        setSyncError({ op, message });
        window.clearTimeout(syncErrorTimer.current);
        syncErrorTimer.current = window.setTimeout(() => setSyncError(null), 4000);
      } finally {
        setSyncing(false);
      }
    },
    [repo, activeRepoPath, syncing, showFlash],
  );

  const handlePull = useCallback(() => void runSync("pull"), [runSync]);
  const handlePush = useCallback(() => void runSync("push"), [runSync]);

  // The manual fetch: the same quiet pull into the tracking refs the open/focus path runs,
  // except a failure speaks up — the user asked for it, so unresponsiveness is worth a toast.
  const [fetching, setFetching] = useState(false);
  const handleFetch = useCallback(async () => {
    const target = repo;
    if (!target || fetching) return;
    setFetching(true);
    try {
      const fetched = await fetchAndRefresh(target);
      if (!fetched) {
        setNotice({
          title: `Could not fetch remotes for ${target.name}`,
          detail: "The view still shows the refs from the last successful fetch.",
          id: Date.now(),
        });
      }
    } finally {
      setFetching(false);
    }
  }, [repo, fetching, fetchAndRefresh]);

  // The refresh button: the same probe the focus path runs, minus the "nothing changed, return
  // null" exit, so clicking it always re-reads the working tree. The uncommitted row refetches
  // through the new worktree digest, and its icon spins while the reads are in flight.
  const handleRefresh = useCallback(async () => {
    if (!repo || refreshing) return;
    const startedAt = performance.now();
    setRefreshing(true);
    try {
      const refreshed = await refreshRepository(repo, true);
      if (refreshed === null) return;
      setRepos((previous) =>
        previous.map((item) => (item.id === refreshed.repo.id ? refreshed.repo : item)),
      );
      showFlash(refreshed.touched);
    } catch (refreshError) {
      console.error("Could not refresh the repository", refreshError);
    } finally {
      // Local reads come back in ~50ms; a spin that short reads as a flicker, so hold the
      // animation long enough to be seen as "it did something".
      const elapsed = performance.now() - startedAt;
      if (elapsed < 550) {
        await new Promise((resolve) => window.setTimeout(resolve, 550 - elapsed));
      }
      setRefreshing(false);
    }
  }, [repo, refreshing, showFlash]);

  // Repo data changes while the app sits in the background: a commit from a terminal, an
  // editor save, a push somewhere else. On window focus the visible repo is re-checked with
  // the cheapest thing that is correct: two cheap git reads, then only the new commits are
  // spliced in — and, once in a while, a quiet fetch catches the drift only the network
  // notices (a push to origin, a new remote branch). The other tabs are untouched; they are
  // off screen and each reload costs a full log read.
  const refreshBusy = useRef(false);
  const lastProbe = useRef(0);
  useEffect(() => {
    if (!repo) return;
    const activeRepo = repo;
    let cancelled = false;

    async function refreshIfChanged() {
      // Alt-tab storms and minimized windows cost nothing: one probe per 1.5s, visible only.
      if (refreshBusy.current || opening || document.visibilityState === "hidden") return;
      if (Date.now() - lastProbe.current < 1500) return;
      lastProbe.current = Date.now();
      refreshBusy.current = true;
      try {
        const refreshed = await refreshRepository(activeRepo);
        if (!cancelled && refreshed !== null) {
          setRepos((previous) =>
            previous.map((item) => (item.id === refreshed.repo.id ? refreshed.repo : item)),
          );
          showFlash(refreshed.touched);
        }
        // Remote state drifts even when the worktree and HEAD stand still; the fetch window
        // keeps a focus parade from turning into a fetch parade.
        if (!cancelled && Date.now() - lastFetchStamp.current >= FETCH_ON_FOCUS_MS) {
          lastFetchStamp.current = Date.now();
          await fetchAndRefresh(activeRepo);
        }
      } catch (refreshError) {
        console.error("Could not refresh the repository", refreshError);
      } finally {
        refreshBusy.current = false;
      }
    }

    const onFocus = () => {
      void refreshIfChanged();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [repo, opening, showFlash]);

  // Tab sleeping, Chrome-style: a tab left inactive long enough drops its history and its
  // cached file payloads. The repo object keeps name/path/branch so the tab strip stays
  // readable; clicking the tab reloads it (handleSelectRepo). Mirrors keep the interval from
  // re-arming on every state change, and the active tab never sleeps.
  const reposRef = useRef<Repository[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const lastActiveAt = useRef<Record<string, number>>({});
  useEffect(() => {
    reposRef.current = repos;
    const now = Date.now();
    for (const item of repos) {
      if (lastActiveAt.current[item.id] === undefined) lastActiveAt.current[item.id] = now;
    }
  }, [repos]);
  useEffect(() => {
    activeIdRef.current = activeRepoId;
    if (activeRepoId) lastActiveAt.current[activeRepoId] = Date.now();
  }, [activeRepoId]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const tired = reposRef.current.filter(
        (item) =>
          !item.sleeping &&
          item.id !== activeIdRef.current &&
          now - (lastActiveAt.current[item.id] ?? now) >= SLEEP_AFTER_MS,
      );
      if (tired.length === 0) return;
      const tiredIds = new Set(tired.map((item) => item.id));
      setRepos((previous) =>
        previous.map((item) =>
          tiredIds.has(item.id) ? { ...item, sleeping: true, commits: [] } : item,
        ),
      );
      for (const item of tired) {
        evictRepoFiles(item.path);
        setAllLoadedByRepo((previous) => ({ ...previous, [item.id]: false }));
        setLoadingMoreByRepo((previous) => ({ ...previous, [item.id]: false }));
      }
    }, SLEEP_TICK_MS);
    return () => window.clearInterval(timer);
  }, [evictRepoFiles]);

  // The highlight is only a hint: drop it once the animation has played out.
  useEffect(() => {
    if (flashHashes.length === 0) return;
    const timer = window.setTimeout(() => setFlashHashes([]), 3000);
    return () => window.clearTimeout(timer);
  }, [flashHashes]);

  const flashSet = useMemo(() => new Set(flashHashes), [flashHashes]);

  // The right-click menu's checkout reuses the branch checkout path; the menu closes itself.
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const handleMenuCheckout = useCallback(
    (branch: string) => {
      closeContextMenu();
      void handleCheckoutBranch(branch);
    },
    [closeContextMenu, handleCheckoutBranch],
  );

  // Writes confirm? A commit checkout detaches HEAD and a drop/pop deletes a stash entry —
  // the menu queues the intent, a dialog owns the warning. Confirming runs the action, then
  // the same reload paths the other write (branch checkout) already uses.
  interface PendingConfirm {
    title: string;
    body: ReactNode;
    confirmLabel: string;
    danger?: boolean;
    run: () => Promise<void> | void;
  }
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  // Esc closes the details panel — from a commit row (Esc undoes the summons) or inside it.
  // Top layers (menu, modal, confirm) close themselves; the rail's Esc docks the drawer; a
  // text field's Esc keeps its own story.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (contextMenu || settingsOpen || pendingConfirm || !detailsOpen) return;
      if (!(event.target instanceof Node)) return;
      const host = event.target as Element;
      if (!host.closest) return;
      if (host.closest("[data-stage-rail]")) return;
      if (host.closest("input, textarea, [contenteditable]")) return;
      event.stopPropagation();
      setDetailsOpen(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [contextMenu, settingsOpen, pendingConfirm, detailsOpen, setDetailsOpen]);

  const handleMenuCheckoutCommit = useCallback(
    (hash: string) => {
      closeContextMenu();
      setPendingConfirm({
        title: `Check out commit ${hash.slice(0, 8)}?`,
        body: (
          <>
            <p>
              HEAD will detach — the checked-out pill reads{" "}
              <span className="font-semibold text-ink">HEAD (detached)</span>. New commits you
              make there are lost unless you create a branch first.
            </p>
            <p>Double-click any branch pill to get back to it.</p>
          </>
        ),
        confirmLabel: "Check out & detach",
        run: async () => {
          if (!activeRepoPath || opening) return;
          try {
            await checkoutCommit(activeRepoPath, hash);
            const refreshed = await loadRepository(activeRepoPath);
            setRepos((previous) =>
              previous.map((item) => (item.id === refreshed.id ? refreshed : item)),
            );
          } catch (checkoutError) {
            setNotice({
              title: `Could not check out ${hash}`,
              detail: checkoutError instanceof Error ? checkoutError.message : String(checkoutError),
              id: Date.now(),
            });
          }
        },
      });
    },
    [closeContextMenu, activeRepoPath, opening],
  );

  // Apply is reversible-ish (it just does to the working tree what it says), so it runs
  // straight away. Pop deletes the entry after a clean apply and drop deletes outright —
  // both go through the dialog, and a failed pop keeps the entry (git's own rule).
  const handleMenuStashAction = useCallback(
    (index: number, action: StashAction) => {
      const target = repos.find((item) => item.id === activeRepoId);
      if (!target) return;
      const label = `stash@{${index}}`;
      const runStash = async () => {
        try {
          await stashAction(target.path, index, action);
          // The stash digest notices a drop, the worktree digest notices an apply, and a
          // drop renumbers the survivors — the forced refresh handles all three at once.
          const refreshed = await refreshRepository(target, true);
          if (refreshed) {
            setRepos((previous) =>
              previous.map((item) => (item.id === refreshed.repo.id ? refreshed.repo : item)),
            );
            showFlash(refreshed.touched);
          }
        } catch (stashError) {
          setNotice({
            title: `Could not ${action} ${label}`,
            detail: stashError instanceof Error ? stashError.message : String(stashError),
            id: Date.now(),
          });
        }
      };
      if (action === "apply") void runStash();
      else
        setPendingConfirm({
          title: action === "drop" ? `Drop ${label}?` : `Apply and drop ${label}?`,
          body: action === "drop" ? (
            <>
              <p>The entry is deleted without applying it; its changes stay parked for good.</p>
              <p>The working tree is untouched. Undo means a terminal and the reflog.</p>
            </>
          ) : (
            <>
              <p>The entry comes back into the working tree, and is deleted once it applies cleanly.</p>
              <p>Conflicts keep the entry, so nothing is lost mid-merge.</p>
            </>
          ),
          confirmLabel: action === "drop" ? "Drop stash" : "Apply & drop",
          danger: true,
          run: runStash,
        });
    },
    [repos, activeRepoId, showFlash],
  );

  // Undoing the tip is the rail's commit in reverse: the dialog says it plainly (staged, not
  // deleted), and a force-refresh re-lands the wip row and the stepped-back history at once.
  const handleMenuUndoCommit = useCallback(
    (hash: string) => {
      const target = repos.find((item) => item.id === activeRepoId);
      if (!target) return;
      setPendingConfirm({
        title: `Undo commit ${hash.slice(0, 8)}?`,
        body: (
          <>
            <p>HEAD steps back one commit and its files return to the working tree, already staged.</p>
            <p>Nothing is deleted — you are back to just before the commit.</p>
          </>
        ),
        confirmLabel: "Undo commit",
        run: async () => {
          setPendingConfirm(null);
          try {
            await undoCommit(target.path);
            const refreshed = await refreshRepository(target, true);
            if (refreshed) {
              setRepos((previous) =>
                previous.map((item) => (item.id === refreshed.repo.id ? refreshed.repo : item)),
              );
              showFlash(refreshed.touched);
            }
          } catch (undoError) {
            setNotice({
              title: "Could not undo the commit",
              detail: undoError instanceof Error ? undoError.message : String(undoError),
              id: Date.now(),
            });
          }
        },
      });
    },
    [repos, activeRepoId, showFlash],
  );

  // The search filters the loaded window only — the visible rows AND the lanes/graph re-layout
  // over the subset. Searching unpaginated history stays out until the deep-search slice.
  const visibleCommits = useMemo(
    () => filterCommits(repo?.commits ?? [], query),
    [repo, query],
  );

  function handleThemeChange(nextTheme: Theme) {
    setTheme(nextTheme);
    storeTheme(nextTheme);
  }

  const workspaceStyle = {
    "--details-height": detailsHeight === null ? "44%" : `${detailsHeight}px`,
    gridTemplateRows: detailsOpen
      ? "minmax(150px, 1fr) min(var(--details-height), calc(100% - 160px))"
      : "minmax(0, 1fr)",
  } as CSSProperties;

  // A commit conflates TWO digest moves (HEAD through the ref digest, the index through the
  // worktree digest); everything else the rail does — stage, unstage, discard — moves only
  // the worktree digest. Any rail action force-refreshes, and the surgical refresh handles
  // whatever its digests notice: history splices in, uncommitted row rebuilds, rail rows
  // reload through this effect (one read, shared with what the refresh already paid for).
  const worktreeDigestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!repo || repo.sleeping) return;
    if (repo.worktree === worktreeDigestRef.current) return;
    worktreeDigestRef.current = repo.worktree;
    let cancelled = false;
    loadWorktree(repo.path)
      .then((rows) => {
        if (!cancelled) setWorktreeFiles(rows);
      })
      .catch((error) => {
        console.error("Could not read the worktree for the staging rail", error);
        if (!cancelled) setWorktreeFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  // One dispatcher for the rail's git writes: the action runs, the repo force-refreshes, and
  // a failure speaks (the rows stay exactly as they were — git refused, nothing half-ran).
  // Speed: each git read costs ~150-400ms of process spawn on Windows, and the rail's row
  // read (3 scans) used to run AFTER the refresh (~4 scans) — strictly sequential chains of
  // the same repo state. Both reads start beside each other now, and the digest ref is
  // pointed at the refreshed digest so the reload effect skips the duplicate read.
  const runStaging = useCallback(
    async (working: (dir: string) => Promise<void>) => {
      if (!repo || !activeRepoPath || stagingBusy) return;
      setStagingBusy(true);
      try {
        await working(activeRepoPath);
        const [rows, refreshed] = await Promise.all([
          loadWorktree(activeRepoPath),
          refreshRepository(repo, true),
        ]);
        // `force` always returns a repo; the null branch satisfies the type contract and
        // rows read directly, so even a null load shows the post-action rail state.
        if (refreshed) {
          worktreeDigestRef.current = refreshed.repo.worktree;
          setRepos((previous) =>
            previous.map((item) => (item.id === refreshed.repo.id ? refreshed.repo : item)),
          );
          showFlash(refreshed.touched);
        }
        setWorktreeFiles(rows);
      } catch (stagingError) {
        setNotice({
          title: "Staging action failed",
          detail:
            stagingError instanceof Error ? stagingError.message : String(stagingError),
          id: Date.now(),
        });
      } finally {
        setStagingBusy(false);
      }
    },
    [repo, activeRepoPath, stagingBusy, showFlash],
  );

  // The rail emptied while docked — commit or discard consumed its rows — so it docks too.
  // Only a same-repo counts-to-zero transition reacts: opening the rail on a deliberately
  // clean repo (to start work) is a stable choice, not something the next read undoes.
  const railFlow = useRef<{ id: string | null; count: number }>({ id: null, count: 0 });
  useEffect(() => {
    if (!repo) return;
    const flow = railFlow.current;
    railFlow.current = { id: repo.id, count: worktreeFiles.length };
    if (flow.id === repo.id && flow.count > 0 && worktreeFiles.length === 0) {
      setStageOpen(false);
    }
  }, [repo, worktreeFiles, setStageOpen]);

  const handleStage = useCallback(
    (paths: string[]) => void runStaging((dir) => stagePaths(dir, paths)),
    [runStaging],
  );
  const handleUnstage = useCallback(
    (paths: string[]) => void runStaging((dir) => unstagePaths(dir, paths)),
    [runStaging],
  );
  const handleDiscard = useCallback(
    (paths: string[]) => void runStaging((dir) => discardPaths(dir, paths)),
    [runStaging],
  );
  // A hunk button: the action runs, the rail and repo refresh like any rail write, and the side
  // reloads explicitly (a hunk moved between index and disk can leave the digest untouched).
  const reloadWipSide = wipSide.reload;
  const handleHunkAction = useCallback(
    (path: string, hunkIndex: number, hunkHeader: string, action: HunkAction) => {
      const side = action === "unstage" ? "staged" : "unstaged";
      void runStaging((dir) => applyHunk(dir, path, side, hunkIndex, hunkHeader, action)).then(
        reloadWipSide,
      );
    },
    [runStaging, reloadWipSide],
  );
  const handleDiscardAll = useCallback(
    () => void runStaging((dir) => discardEverything(dir)),
    [runStaging],
  );

  const handleResolveConflicts = useCallback(
    (paths: string[], side: "ours" | "theirs") =>
      void runStaging((dir) => resolveConflictSides(dir, paths, side)),
    [runStaging],
  );
  // Abort walks back to the pre-merge tip: details close (the wip diff would show nothing),
  // and the rail's rows re-read through the same force refresh the other rail writes use.
  const handleAbortMerge = useCallback(() => {
    setConflictView(null);
    setDetailsOpen(false);
    void runStaging((dir) => abortMerge(dir));
  }, [runStaging, setDetailsOpen]);
  const handleCompleteMerge = useCallback(() => {
    setConflictView(null);
    void runStaging((dir) => completeMerge(dir));
  }, [runStaging]);

  // A conflict row click: the uncommitted row is summoned (the conflict view is its diff),
  // both sides read, and the details panel rises above them.
  const handleSelectConflict = useCallback(
    (path: string) => {
      if (!activeRepoId || !activeRepoPath) return;
      setSelectedCommitByRepo((previous) => ({ ...previous, [activeRepoId]: UNCOMMITTED_HASH }));
      setDetailsOpen(true);
      loadConflictFiles(activeRepoPath, path)
        .then((snapshot) => setConflictView({ path, snapshot }))
        .catch((error) => {
          console.error("Could not read the conflict sides", error);
          setConflictView(null);
        });
    },
    [activeRepoId, activeRepoPath, setSelectedCommitByRepo, setDetailsOpen],
  );

  // A block choice rewrites the file; the view then re-reads it so the next block (or the
  // resolved state, once nothing conflicts) shows without another click.
  const handleWriteConflictText = useCallback(
    async (path: string, text: string) => {
      if (!activeRepoPath) return;
      await runStaging((dir) => writeConflictResolution(dir, path, text));
      const snapshot = await loadConflictFiles(activeRepoPath, path).catch(() => null);
      if (snapshot) setConflictView({ path, snapshot });
    },
    [activeRepoPath, runStaging],
  );

  // The conflict view rides the repo's conflict list: once the path is resolved, aborted out,
  // or the tab switched, the panes would show stale sides — drop it.
  useEffect(() => {
    if (!conflictView) return;
    if (repo?.conflicts?.includes(conflictView.path)) return;
    setConflictView(null);
  }, [repo, conflictView]);

  // A commit succeeds → the rail docks: the burst it serves is over (and the new commit row,
  // spliced by the same refresh, flashes, so the work's landing place is visible).
  const handleStageCommit = useCallback(
    (message: string) => {
      setStageOpen(false);
      void runStaging(async (dir) => {
        await commitStaged(dir, message);
      });
    },
    [setStageOpen, runStaging],
  );

  // The badge in the title bar is the rail's always-visible door.
  const handleToggleStage = useCallback(() => {
    setStageOpen(!stageOpen);
  }, [setStageOpen, stageOpen]);

  // Swipe-to-dock: dragging the rail under the collapse threshold docks it just like the ×;
  // anything above stays as a pinned px width between MIN and MAX.
  const handleStageResize = useCallback(
    (width: number) => {
      if (width < MIN_STAGE_WIDTH) setStageOpen(false);
      else setStageWidth(width);
    },
    [setStageOpen, setStageWidth],
  );

  const noRepo = repo === null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TitleBar
        repos={repos}
        activeId={repo?.id ?? null}
        repo={repo}
        adding={opening}
        refreshing={refreshing}
        query={query}
        onQueryChange={setQuery}
        onSelect={handleSelectRepo}
        onAdd={handleAdd}
        onClose={handleCloseRepo}
        onReorder={handleReorderRepos}
        onRefresh={() => void handleRefresh()}
        onFetch={() => void handleFetch()}
        fetching={fetching}
        onOpenSettings={() => setSettingsOpen(true)}
        updateReady={updateStatus.phase === "ready"}
        onPull={handlePull}
        onPush={handlePush}
        syncing={syncing}
        syncError={syncError}
        stageCount={railFiles.length + (repo?.conflicts?.length ?? 0)}
        stageOpen={stageOpen}
        onToggleStage={handleToggleStage}
      />

      <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-2.5 pt-1">
        {noRepo || repo === null ? (
          booting ? (
            <BootScreen />
          ) : (
            <EmptyState onOpen={handleAdd} loading={opening} repos={repos} />
          )
        ) : (
          <div className="flex min-h-0 flex-1 gap-2.5">
            {stageOpen && (
              // The relatively positioned wrapper is what the splitter straddles: it sits on
              // the flex row (never clipped by the panel's overflow-hidden) and carries the
              // pinned width; double-click or Home resets it to the tuned default.
              <div
                className="relative shrink-0"
                style={{ width: stageWidth ?? DEFAULT_STAGE_WIDTH }}
                data-stage-rail
              >
                <StagePanel
                  branch={repo.branch}
                  files={railFiles}
                  busy={stagingBusy}
                  merging={repo.merging === true}
                  conflicts={repo.conflicts ?? []}
                  onResolve={handleResolveConflicts}
                  onAbortMerge={handleAbortMerge}
                  onCompleteMerge={handleCompleteMerge}
                  onSelectConflict={handleSelectConflict}
                  onStage={handleStage}
                  onUnstage={handleUnstage}
                  onDiscard={handleDiscard}
                  onDiscardAll={handleDiscardAll}
                  onCommit={handleStageCommit}
                  onSelectRow={handleRailSelectFile}
                  selection={
                    isWipSelected && !conflictView && wipSide.selectedFile
                      ? { path: wipSide.selectedFile.path, staged: wipSide.side === "staged" }
                      : null
                  }
                  onClose={() => setStageOpen(false)}
                />
                <ResizeHandle
                  label="Resize staging rail width"
                  edgeRule
                  // left-full: the handle box starts at the wrapper's right edge, and the
                  // splitter's own -translate-x-1/2 then centers its rule on the boundary —
                  // right-0 parked it half the handle inside the glass.
                  className="left-full"
                  min={MIN_STAGE_WIDTH - 60}
                  max={MAX_STAGE_WIDTH}
                  value={stageWidth ?? DEFAULT_STAGE_WIDTH}
                  measure={() => stageWidth ?? DEFAULT_STAGE_WIDTH}
                  onResize={handleStageResize}
                  onReset={() => setStageWidth(null)}
                />
              </div>
            )}
            <div className="relative grid min-h-0 flex-1 gap-2.5" style={workspaceStyle}>
              <CommitList
              repo={repo}
              commits={visibleCommits}
              query={query}
              selectedHash={selectedCommit?.hash ?? ""}
              onSelect={handleSelectCommit}
              flashHashes={flashSet}
            loadingMore={loadingMoreByRepo[repo.id] ?? false}
              waking={repo.id === wakingId}
              showAvatars={showAvatars}
              onNearBottom={handleNearBottom}
              onCheckoutBranch={handleCheckoutBranch}
              onContextMenu={(commit, ref, x, y) => {
                // The uncommitted row owns no menu (empty pseudo hash, no refs): a right-click
                // there would only ever draw an empty box, so it draws nothing.
                if (commit.hash === UNCOMMITTED_HASH) return;
                setContextMenu({ commit, ref, x, y });
              }}
            />
            {detailsOpen && selectedCommit !== null && (
              <DetailsPanel
                commit={selectedCommit}
                repoPath={repo.path}
                files={isWipSelected ? wipSide.files : files}
                filesLoading={filesLoading}
                selectedFile={isWipSelected ? wipSide.selectedFile : selectedFile}
                onSelectFile={handleSelectFile}
                onPatchNeeded={isWipSelected ? undefined : handlePatchNeeded}
                hunkActions={
                  isWipSelected
                    ? { side: wipSide.side, busy: stagingBusy, onAction: handleHunkAction }
                    : undefined
                }
                diffScope={diffScope}
                onDiffScopeChange={setDiffScope}
                diffLayout={diffLayout}
                onDiffLayoutChange={setDiffLayout}
                diffWrap={diffWrap}
                onDiffWrapChange={setDiffWrap}
                syntaxScheme={syntaxScheme}
                showAvatars={showAvatars}
                onCheckoutBranch={handleCheckoutBranch}
                onRefContextMenu={(ref, x, y) => {
                  // The wip row never reaches here (no sidebar), so no empty-menu guard needed.
                  setContextMenu({ commit: selectedCommit, ref, x, y });
                }}
                isWorktree={selectedCommit.hash === UNCOMMITTED_HASH}
                conflict={conflictView}
                onResolveConflict={handleResolveConflicts}
                onWriteConflictText={handleWriteConflictText}
                currentBranch={repo.branch}
                onClose={() => setDetailsOpen(false)}
                onHeightChange={setDetailsHeight}
              />
            )}
            </div>
          </div>
        )}
      </div>

      {settingsOpen && (
        <SettingsModal
          theme={theme}
          onThemeChange={handleThemeChange}
          showAvatars={showAvatars}
          onShowAvatarsChange={setShowAvatars}
          syntaxScheme={syntaxScheme}
          onSyntaxSchemeChange={setSyntaxScheme}
          appVersion={appVersion}
          updateMode={updateMode}
          onUpdateModeChange={setUpdateMode}
          updateStatus={updateStatus}
          onCheckForUpdates={handleCheckForUpdates}
          onDownloadUpdate={handleDownloadUpdate}
          onRestartToUpdate={handleRestartToUpdate}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {contextMenu && (
        <ContextMenu
          target={contextMenu}
          onCheckout={handleMenuCheckout}
          onCheckoutCommit={handleMenuCheckoutCommit}
          onStashAction={handleMenuStashAction}
          // The offer exists only on the checked-out tip itself, only while it is unpushed
          // (ahead of the tracking refs) and only when the tip is a plain (non-merge) commit;
          // a pushed tip would need a force-push to land, so it never reads one here.
          undoable={
            repo !== null &&
            contextMenu.commit.hash === repo.head &&
            repo.ahead >= 1 &&
            contextMenu.commit.parents.length === 1 &&
            contextMenu.commit.stashIndex === undefined
          }
          onUndoCommit={() => handleMenuUndoCommit(contextMenu.commit.hash)}
          head={repo?.head ?? ""}
          onMerge={handleMergeBranch}
          currentBranch={
            repo !== null && !repo.branch.startsWith("HEAD") ? repo.branch : undefined
          }
          onClose={closeContextMenu}
        />
      )}

      {pendingConfirm !== null && (
        <ConfirmDialog
          title={pendingConfirm.title}
          body={pendingConfirm.body}
          confirmLabel={pendingConfirm.confirmLabel}
          danger={pendingConfirm.danger}
          // Confirming is one gesture: the dialog always closes, and the run's failures
          // surface as the toast — never as a dialog that outstays its welcome.
          onConfirm={() => {
            setPendingConfirm(null);
            void pendingConfirm.run();
          }}
          onClose={() => setPendingConfirm(null)}
        />
      )}

      {notice && (
        <Toast
          key={notice.id}
          title={notice.title}
          detail={notice.detail}
          onClose={() => setNotice(null)}
        />
      )}
    </div>
  );
}

export default App;
