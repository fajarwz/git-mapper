import { useCallback, useEffect, useRef, useState } from "react";

const EXIT_MS = 150;

/**
 * Delays `onClose` by the exit animation. `close` flips `leaving` (the caller swaps in the
 * pop-out classes) and fires `onClose` once it has played; repeat calls are ignored. Reduced
 * motion has no animation to wait for, so it closes at once.
 */
export function useExit(onClose: () => void) {
  const [leaving, setLeaving] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const timer = useRef<number | undefined>(undefined);

  const close = useCallback(() => {
    if (timer.current !== undefined) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      timer.current = 0;
      closeRef.current();
      return;
    }
    setLeaving(true);
    timer.current = window.setTimeout(() => closeRef.current(), EXIT_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { leaving, close };
}
