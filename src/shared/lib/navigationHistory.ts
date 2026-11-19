// Back/forward history across every open repository, VS Code style: one global list of
// places the reader has been. Pure state transitions only; the hook owns timing and wiring.

export interface NavLocation {
  repoId: string;
  commitHash: string;
  filePath: string | null;
}

export interface NavHistory {
  entries: NavLocation[];
  index: number;
}

export const NAV_HISTORY_CAP = 100;

export const EMPTY_NAV_HISTORY: NavHistory = { entries: [], index: -1 };

export function sameLocation(a: NavLocation, b: NavLocation): boolean {
  return a.repoId === b.repoId && a.commitHash === b.commitHash && a.filePath === b.filePath;
}

/**
 * Records a new place. Landing where the reader already is changes nothing; anywhere else
 * drops the forward entries (as a browser does) and appends, trimming the oldest past the cap.
 */
export function pushLocation(history: NavHistory, location: NavLocation): NavHistory {
  const current = history.entries[history.index];
  if (current && sameLocation(current, location)) return history;
  const entries = [...history.entries.slice(0, history.index + 1), location];
  const overflow = Math.max(0, entries.length - NAV_HISTORY_CAP);
  return { entries: entries.slice(overflow), index: entries.length - overflow - 1 };
}

export const canGoBack = (history: NavHistory): boolean => history.index > 0;
export const canGoForward = (history: NavHistory): boolean =>
  history.index >= 0 && history.index < history.entries.length - 1;

/**
 * One step back (-1) or forward (1), skipping entries that no longer exist (a closed tab, a
 * commit a rebase removed). Null when there is nothing valid in that direction.
 */
export function stepHistory(
  history: NavHistory,
  delta: -1 | 1,
  isValid: (location: NavLocation) => boolean,
): { history: NavHistory; location: NavLocation } | null {
  let index = history.index + delta;
  while (index >= 0 && index < history.entries.length && !isValid(history.entries[index])) {
    index += delta;
  }
  if (index < 0 || index >= history.entries.length) return null;
  return { history: { entries: history.entries, index }, location: history.entries[index] };
}
