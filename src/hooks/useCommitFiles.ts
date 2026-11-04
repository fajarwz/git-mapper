import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangedFile, Commit, DiffLine, Repository } from "../types";
import { FILES_CACHE_CAP, UNCOMMITTED_HASH, loadCommitFiles, loadFilePatch } from "../data/gitLoader";

/**
 * Key for the loaded-files cache. It has to include the repo: the uncommitted row uses the
 * same pseudo hash ("wip") in every repository, so a hash-only key showed one repo's working-tree
 * changes in another. The uncommitted entry is keyed by the working-tree digest instead of the
 * hash, so a save (or a new untracked file) refetches the list and the patch.
 */
function filesKey(repoPath: string, hash: string, worktree: string): string {
  return hash === UNCOMMITTED_HASH ? `${repoPath}::~wip:${worktree}` : `${repoPath}::${hash}`;
}

/**
 * The changed files of the selected commit: list loads without patch bodies (heavy), and each
 * file's unified diff arrives lazily through handlePatchNeeded when a diff pane asks for it.
 * The cache is an LRU across repos; a closed or sleeping tab evicts its whole slice.
 */
export function useCommitFiles({
  repo,
  selectedCommit,
  selectedFilePath,
}: {
  repo: Repository | null;
  selectedCommit: Commit | null;
  selectedFilePath: string | null;
}) {
  // Insert order of the cache keys, newest last: the cap drops from the front (least recently
  // used). Full patch text per commit adds up fast, and nothing ever read it back before.
  const [filesByCommitHash, setFilesByCommitHash] = useState<Record<string, ChangedFile[]>>({});
  const filesCacheOrder = useRef<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  const selectedFilesKey =
    repo && selectedCommit
      ? filesKey(repo.path, selectedCommit.hash, repo.worktree)
      : null;
  const files = selectedFilesKey ? (filesByCommitHash[selectedFilesKey] ?? []) : [];
  // null means "fall back to the first changed file", which a fresh commit selection wants.
  const selectedFile = useMemo(
    () => files.find((file) => file.path === selectedFilePath) ?? files[0] ?? null,
    [files, selectedFilePath],
  );

  const storeFiles = useCallback((key: string, files: ChangedFile[]) => {
    const order = filesCacheOrder.current.filter((cached) => cached !== key);
    order.push(key);
    const evicted = order.length > FILES_CACHE_CAP ? order.splice(0, order.length - FILES_CACHE_CAP) : [];
    filesCacheOrder.current = order;
    setFilesByCommitHash((previous) => {
      if (evicted.length === 0) return { ...previous, [key]: files };
      const next = { ...previous, [key]: files };
      for (const dropped of evicted) delete next[dropped];
      return next;
    });
  }, []);

  // Drops every cached payload of one repository: when its tab closes, and when the tab sleeps.
  const evictRepoFiles = useCallback((repoPath: string) => {
    const prefix = `${repoPath}::`;
    const kept = filesCacheOrder.current.filter((key) => !key.startsWith(prefix));
    if (kept.length === filesCacheOrder.current.length) return;
    filesCacheOrder.current = kept;
    setFilesByCommitHash((previous) => {
      const next: Record<string, ChangedFile[]> = {};
      for (const key of kept) next[key] = previous[key];
      return next;
    });
  }, []);

  // Files load per selected commit — false = without the patch body (patches are lazy).
  useEffect(() => {
    if (!repo || !selectedCommit || !selectedFilesKey) return;
    if (filesByCommitHash[selectedFilesKey]) return;
    const cacheKey = selectedFilesKey;
    let cancelled = false;
    setFilesLoading(true);
    loadCommitFiles(repo.path, selectedCommit.hash, false)
      .then((loaded) => {
        if (!cancelled) storeFiles(cacheKey, loaded);
      })
      .catch((loadError) => {
        if (!cancelled) {
          console.error("Could not read changed files", loadError);
          storeFiles(cacheKey, []);
        }
      })
      .finally(() => {
        if (!cancelled) setFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, selectedCommit, selectedFilesKey, filesByCommitHash, storeFiles]);

  // In-flight reads are stamped per "<filesKey>:<path>"; a failed one stores [] so a vanished
  // file cannot retry-loop.
  const patchesFetching = useRef(new Set<string>());
  const mergePatch = useCallback((cacheKey: string, path: string, patch: DiffLine[]) => {
    const order = filesCacheOrder.current.filter((entry) => entry !== cacheKey);
    order.push(cacheKey);
    filesCacheOrder.current = order;
    setFilesByCommitHash((previous) => {
      const listed = previous[cacheKey];
      if (!listed) return previous;
      return {
        ...previous,
        [cacheKey]: listed.map((file) =>
          file.path === path ? { ...file, diff: patch } : file,
        ),
      };
    });
  }, []);
  const filesCacheRef = useRef(filesByCommitHash);
  filesCacheRef.current = filesByCommitHash;
  const handlePatchNeeded = useCallback(
    (path: string) => {
      const source = repo;
      const commit = selectedCommit;
      const cacheKey = selectedFilesKey;
      if (!source || !commit || !cacheKey) return;
      const stamp = `${cacheKey}:${path}`;
      if (patchesFetching.current.has(stamp)) return;
      const listed = filesCacheRef.current[cacheKey];
      const entry = listed?.find((file) => file.path === path);
      if (!entry || entry.diff !== null) return;
      patchesFetching.current.add(stamp);
      loadFilePatch(source.path, commit.hash, path)
        .then((patch) => mergePatch(cacheKey, path, patch))
        .catch((patchError) => {
          console.error("Could not read the file patch", patchError);
          mergePatch(cacheKey, path, []);
        })
        .finally(() => patchesFetching.current.delete(stamp));
    },
    [repo, selectedCommit, selectedFilesKey, mergePatch],
  );

  return { files, selectedFile, filesLoading, handlePatchNeeded, evictRepoFiles };
}
