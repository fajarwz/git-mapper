import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangedFile } from "../types";
import { loadWipSide, type WipSide } from "../data/gitLoader";
import type { WorktreeFile } from "../lib/staging";

/**
 * The uncommitted diff the way VS Code shows it: one side at a time, picked by the rail row that
 * was clicked (staged = HEAD→index, unstaged = index→disk). A side with no rows left falls back
 * to the other one, so staging the last hunk of a file lands on its remaining half.
 */
export function useWipSide({
  repoPath,
  active,
  rows,
  hiddenPaths,
  digest,
  selectedFilePath,
}: {
  repoPath: string | null;
  /** True while the uncommitted row is the selected commit. */
  active: boolean;
  /** The rail's rows: they say which sides have anything to show. */
  rows: WorktreeFile[];
  /** Paths the rail lists elsewhere (merge conflicts): this diff never stacks them. */
  hiddenPaths?: string[];
  /** The worktree digest; a move reloads the side. */
  digest: string | undefined;
  selectedFilePath: string | null;
}) {
  const [chosen, setChosen] = useState<WipSide | null>(null);
  // Bumped after a hunk action: staging within an already-MM file moves neither the status
  // list nor `git diff HEAD`, so the digest alone would leave the pane stale.
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; files: ChangedFile[] } | null>(null);

  const hasStaged = rows.some((row) => row.staged);
  const hasUnstaged = rows.some((row) => !row.staged);
  const side: WipSide =
    chosen === "staged" && hasStaged
      ? "staged"
      : chosen === "unstaged" && hasUnstaged
        ? "unstaged"
        : hasUnstaged
          ? "unstaged"
          : "staged";

  useEffect(() => {
    if (!repoPath || !active) return;
    let cancelled = false;
    const key = `${repoPath}:${side}`;
    loadWipSide(repoPath, side)
      .then((files) => {
        if (!cancelled) setLoaded({ key, files });
      })
      .catch((error) => {
        console.error("Could not read the uncommitted side", error);
        if (!cancelled) setLoaded({ key, files: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, active, side, digest, version]);

  const files = useMemo(() => {
    if (!loaded || loaded.key !== `${repoPath}:${side}`) return [];
    if (!hiddenPaths?.length) return loaded.files;
    const hidden = new Set(hiddenPaths);
    return loaded.files.filter((file) => !hidden.has(file.path));
  }, [loaded, repoPath, side, hiddenPaths]);
  const selectedFile = useMemo(
    () => files.find((file) => file.path === selectedFilePath) ?? files[0] ?? null,
    [files, selectedFilePath],
  );

  const pickSide = useCallback((next: WipSide | null) => setChosen(next), []);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  return { side, files, selectedFile, pickSide, reload };
}
