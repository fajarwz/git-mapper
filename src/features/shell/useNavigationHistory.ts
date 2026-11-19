import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_NAV_HISTORY,
  canGoBack,
  canGoForward,
  pushLocation,
  sameLocation,
  stepHistory,
  type NavHistory,
  type NavLocation,
} from "../../shared/lib/navigationHistory";

/** A selection must hold this long to count; scrubbing the list with the arrow keys must not. */
export const NAV_COALESCE_MS = 400;
/** While replaying a back/forward step, selection changes that are not it are the step's own. */
const REPLAY_GRACE_MS = 600;

interface Options {
  /** Where the reader is now; null while nothing is selected (no repo, still loading). */
  current: NavLocation | null;
  /** Applies a location: switch tab (waking it), select the commit and the file. */
  navigate: (location: NavLocation) => void;
  /** False for a location that no longer exists; back/forward skip it. */
  isValid: (location: NavLocation) => boolean;
}

export interface NavigationHistory {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

/**
 * VS Code style back/forward across every open repository. Watches the selection, records a
 * place once it has settled, and replays one with `navigate` without recording the replay.
 * Alt+Left / Alt+Right and the mouse's back/forward buttons drive it.
 */
export function useNavigationHistory({ current, navigate, isValid }: Options): NavigationHistory {
  const [history, setHistory] = useState<NavHistory>(EMPTY_NAV_HISTORY);
  const historyRef = useRef(history);
  const pendingRef = useRef<NavLocation | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const replayRef = useRef<{ target: NavLocation; until: number } | null>(null);
  const currentRef = useRef(current);
  const navigateRef = useRef(navigate);
  const isValidRef = useRef(isValid);
  currentRef.current = current;
  navigateRef.current = navigate;
  isValidRef.current = isValid;

  const commit = useCallback((next: NavHistory) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  // Records the settled place now (also called before a step so "where I am" is on the list).
  const flush = useCallback(() => {
    window.clearTimeout(timerRef.current);
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) commit(pushLocation(historyRef.current, pending));
  }, [commit]);

  const repoId = current?.repoId;
  const commitHash = current?.commitHash;
  const filePath = current?.filePath ?? null;
  useEffect(() => {
    if (!repoId || !commitHash) return;
    const location: NavLocation = { repoId, commitHash, filePath };
    const replay = replayRef.current;
    if (replay) {
      const arrived = sameLocation(replay.target, location);
      const expired = Date.now() > replay.until;
      if (arrived || expired) replayRef.current = null;
      if (arrived) return;
      if (!expired) return;
    }
    pendingRef.current = location;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flush, NAV_COALESCE_MS);
  }, [repoId, commitHash, filePath, flush]);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const step = useCallback(
    (delta: -1 | 1) => {
      flush();
      const result = stepHistory(historyRef.current, delta, (location) => isValidRef.current(location));
      if (!result) return;
      commit(result.history);
      const now = currentRef.current;
      if (!now || !sameLocation(now, result.location)) {
        replayRef.current = { target: result.location, until: Date.now() + REPLAY_GRACE_MS };
      }
      navigateRef.current(result.location);
    },
    [flush, commit],
  );
  const goBack = useCallback(() => step(-1), [step]);
  const goForward = useCallback(() => step(1), [step]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return;
      if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else return;
      event.preventDefault();
    }
    // Mouse buttons 3 and 4 are the side "back" and "forward" buttons; the webview would
    // otherwise try its own page history, which this single-page app does not have.
    function onMouse(event: MouseEvent) {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (event.type === "mouseup") step(event.button === 3 ? -1 : 1);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouse);
    window.addEventListener("mouseup", onMouse);
    window.addEventListener("auxclick", onMouse);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("mouseup", onMouse);
      window.removeEventListener("auxclick", onMouse);
    };
  }, [step]);

  return {
    canGoBack: canGoBack(history),
    canGoForward: canGoForward(history),
    goBack,
    goForward,
  };
}
