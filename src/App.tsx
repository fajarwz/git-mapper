import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { repositories } from "./data/repositories";
import { CommitList } from "./components/CommitList";
import { DetailsPanel } from "./components/DetailsPanel";
import { RepoTabs } from "./components/RepoTabs";
import { SettingsModal } from "./components/SettingsModal";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { applyTheme, initialTheme, storeTheme } from "./lib/theme";
import type { Theme } from "./lib/theme";

const initialSelectedCommit: Record<string, string> = Object.fromEntries(
  repositories.map((repo) => [repo.id, repo.defaultCommitHash]),
);

function App() {
  const [activeRepoId, setActiveRepoId] = useState(repositories[0].id);
  const [selectedCommitByRepo, setSelectedCommitByRepo] =
    useState<Record<string, string>>(initialSelectedCommit);
  // null means "fall back to the first changed file", which is what a fresh commit selection wants.
  const [selectedFileByRepo, setSelectedFileByRepo] = useState<Record<string, string | null>>({});

  // Bottom panel: collapsible, and its height is draggable (null = the default percentage).
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [detailsHeight, setDetailsHeight] = useState<number | null>(null);

  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const repo = useMemo(
    () => repositories.find((item) => item.id === activeRepoId) ?? repositories[0],
    [activeRepoId],
  );

  const selectedHash = selectedCommitByRepo[repo.id] ?? repo.defaultCommitHash;
  const selectedCommit =
    repo.commits.find((commit) => commit.hash === selectedHash) ?? repo.commits[0];

  const selectedPath = selectedFileByRepo[repo.id] ?? null;
  const selectedFile =
    selectedCommit.files.find((file) => file.path === selectedPath) ??
    selectedCommit.files[0] ??
    null;

  function handleSelectRepo(id: string) {
    setActiveRepoId(id);
  }

  function handleSelectCommit(hash: string) {
    setSelectedCommitByRepo((previous) => ({ ...previous, [repo.id]: hash }));
    setSelectedFileByRepo((previous) => ({ ...previous, [repo.id]: null }));
    // Picking a commit is a request to read it, so bring the details panel back if it was closed.
    setDetailsOpen(true);
  }

  function handleSelectFile(path: string) {
    setSelectedFileByRepo((previous) => ({ ...previous, [repo.id]: path }));
  }

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

  return (
    <div className="grid h-screen grid-rows-[52px_40px_minmax(0,1fr)_26px] gap-2.5 overflow-hidden p-2.5">
      <Toolbar
        repo={repo}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((open) => !open)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <RepoTabs repos={repositories} activeId={repo.id} onSelect={handleSelectRepo} />

      <div className="relative grid min-h-0 gap-2.5" style={workspaceStyle}>
        <CommitList repo={repo} selectedHash={selectedCommit.hash} onSelect={handleSelectCommit} />
        {detailsOpen && (
          <DetailsPanel
            commit={selectedCommit}
            selectedFile={selectedFile}
            onSelectFile={handleSelectFile}
            onClose={() => setDetailsOpen(false)}
            onHeightChange={setDetailsHeight}
          />
        )}
      </div>

      <StatusBar repo={repo} commit={selectedCommit} repoCount={repositories.length} />

      {settingsOpen && (
        <SettingsModal
          theme={theme}
          onThemeChange={handleThemeChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
