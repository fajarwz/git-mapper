import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { ChangedFile } from "./types";
import { CommitList } from "./components/CommitList";
import { ContextMenu, type ContextMenuTarget } from "./components/ContextMenu";
import { DetailsPanel } from "./components/DetailsPanel";
import { EmptyState } from "./components/EmptyState";
import { TitleBar } from "./components/TitleBar";
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
import {
  checkoutBranch,
  loadCommitFiles,
  loadMoreCommits,
  loadRepository,
  pickAndLoadRepository,
  readStoredPaths,
  refreshRepository,
  UNCOMMITTED_HASH,
  storePaths,
} from "./data/gitLoader";
import type { Repository } from "./types";

/**
 * Key for the loaded-files cache. It has to include the repo: the uncommitted row uses the same
 * pseudo hash ("wip") in every repository, so a hash-only key showed one repo's working-tree
 * changes in another. The uncommitted entry is keyed by the working-tree digest instead of the
 * hash, so a save (or a new untracked file) refetches the list and the patch.
 */
function filesKey(repoPath: string, hash: string, worktree: string): string {
  return hash === UNCOMMITTED_HASH ? `${repoPath}::~wip:${worktree}` : `${repoPath}::${hash}`;
}

function App() {
  const [repos, setRepos] = useState<Repository[]>([]);
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
  const [filesByCommitHash, setFilesByCommitHash] = useState<Record<string, ChangedFile[]>>({});
  const [loadingMoreByRepo, setLoadingMoreByRepo] = useState<Record<string, boolean>>({});
  const [allLoadedByRepo, setAllLoadedByRepo] = useState<Record<string, boolean>>({});
  const [filesLoading, setFilesLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Updates: auto (background download on launch) by default, manual as the opt-out.
  const [updateMode, setUpdateMode] = usePersistedState<UpdateMode>(STORAGE_KEYS.updateMode, "auto");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(updateStatusSnapshot());
  const [appVersion, setAppVersion] = useState("");

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
  // machine-specific path is baked into the build.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = readStoredPaths();
      const loaded: Repository[] = [];
      for (const path of stored) {
        try {
          loaded.push(await loadRepository(path));
        } catch (loadError) {
          console.error(`Could not open ${path}`, loadError);
        }
      }
      if (cancelled) return;
      hydratedPaths.current = true;
      setRepos(loaded);
      const restored = loaded.some((item) => item.id === activeRepoId) ? activeRepoId : null;
      setActiveRepoId(restored ?? loaded[0]?.id ?? null);
    })();
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

  const selectedCommit = repo
    ? (repo.commits.find(
        (commit) => commit.hash === (selectedCommitByRepo[repo.id] ?? repo.defaultCommitHash),
      ) ?? repo.commits[0] ?? null)
    : null;
  const selectedFilesKey =
    repo && selectedCommit
      ? filesKey(repo.path, selectedCommit.hash, repo.worktree)
      : null;
  const files = selectedFilesKey ? (filesByCommitHash[selectedFilesKey] ?? []) : [];
  const selectedFile =
    files.find((file) => file.path === (selectedFileByRepo[repo?.id ?? ""] ?? null)) ??
    files[0] ??
    null;

  // Real diffs load per selected commit; files stay out of the commit list on purpose.
  useEffect(() => {
    if (!repo || !selectedCommit || !selectedFilesKey) return;
    if (filesByCommitHash[selectedFilesKey]) return;
    const cacheKey = selectedFilesKey;
    let cancelled = false;
    setFilesLoading(true);
    loadCommitFiles(repo.path, selectedCommit.hash)
      .then((loaded) => {
        if (!cancelled) setFilesByCommitHash((prev) => ({ ...prev, [cacheKey]: loaded }));
      })
      .catch((loadError) => {
        if (!cancelled) {
          console.error("Could not read changed files", loadError);
          setFilesByCommitHash((prev) => ({ ...prev, [cacheKey]: [] }));
        }
      })
      .finally(() => {
        if (!cancelled) setFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, selectedCommit, selectedFilesKey, filesByCommitHash]);

  const handleSelectRepo = useCallback((id: string) => {
    setActiveRepoId(id);
    setQuery("");
  }, [setActiveRepoId]);

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
    setError(null);
    try {
      const opened = await pickAndLoadRepository();
      if (!opened) return;
      setRepos((previous) =>
        previous.some((item) => item.path === opened.path) ? previous : [...previous, opened],
      );
      setActiveRepoId(opened.id);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setOpening(false);
    }
  }

  function handleCloseRepo(id: string) {
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
    // Picking a commit is a request to read it, so bring the details panel back if it was closed.
    setDetailsOpen(true);
  }, [activeRepoId, setDetailsOpen, setSelectedCommitByRepo, setSelectedFileByRepo]);

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
      setError(checkoutError instanceof Error ? checkoutError.message : String(checkoutError));
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
  // editor save, a fetch that brings new remote branches. On window focus we re-check the
  // visible repo only, and refreshRepository does the cheapest thing that is correct: two
  // cheap git reads, then only the new commits are spliced in. The other tabs are not
  // touched — they are off screen and each reload costs a full log read.
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
        if (cancelled || refreshed === null) return;
        setRepos((previous) =>
          previous.map((item) => (item.id === refreshed.repo.id ? refreshed.repo : item)),
        );
        showFlash(refreshed.touched);
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
        onOpenSettings={() => setSettingsOpen(true)}
        updateReady={updateStatus.phase === "ready"}
      />

      <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-2.5 pt-1">
        {noRepo || repo === null ? (
          <EmptyState onOpen={handleAdd} error={error} loading={opening} repos={repos} />
        ) : (
          <div className="relative grid min-h-0 flex-1 gap-2.5" style={workspaceStyle}>
            <CommitList
              repo={repo}
              commits={visibleCommits}
              query={query}
              selectedHash={selectedCommit?.hash ?? ""}
              onSelect={handleSelectCommit}
              flashHashes={flashSet}
            loadingMore={loadingMoreByRepo[repo.id] ?? false}
              onNearBottom={handleNearBottom}
              onCheckoutBranch={handleCheckoutBranch}
              onContextMenu={(commit, ref, x, y) => setContextMenu({ commit, ref, x, y })}
            />
            {detailsOpen && selectedCommit !== null && (
              <DetailsPanel
                commit={selectedCommit}
                files={files}
                filesLoading={filesLoading}
                selectedFile={selectedFile}
                onSelectFile={handleSelectFile}
                syntaxScheme={syntaxScheme}
                onClose={() => setDetailsOpen(false)}
                onHeightChange={setDetailsHeight}
              />
            )}
          </div>
        )}
      </div>

      {settingsOpen && (
        <SettingsModal
          theme={theme}
          onThemeChange={handleThemeChange}
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
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}

export default App;
