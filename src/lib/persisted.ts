import { useEffect, useState } from "react";

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * useState that survives a restart: the value is read once on mount and written back on
 * every change. Synchronous read, so nothing has to wait for hydration before rendering.
 */
export function usePersistedState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStored(key, fallback));

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable (private mode); the in-memory value still applies.
    }
  }, [key, value]);

  return [value, setValue] as const;
}

/** Keys the app restores on launch, in one place so they can be cleared together. */
export const STORAGE_KEYS = {
  theme: "git-mapper:theme",
  repos: "git-mapper:open-repos",
  activeRepo: "git-mapper:active-repo",
  selectedCommits: "git-mapper:selected-commits",
  selectedFiles: "git-mapper:selected-files",
  detailsOpen: "git-mapper:details-open",
  detailsHeight: "git-mapper:details-height",
  syntaxScheme: "git-mapper:syntax-scheme",
  diffScope: "git-mapper:diff-scope",
  updateMode: "git-mapper:update-mode",
} as const;
