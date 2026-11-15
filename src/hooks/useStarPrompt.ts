import { useEffect, useRef, useState } from "react";
import { GITHUB_URL } from "../lib/updater";
import { openExternal } from "../lib/external";
import { STORAGE_KEYS, usePersistedState } from "../lib/persisted";
import {
  dismissLater,
  initialStarState,
  markDone,
  recordLaunch,
  shouldPrompt,
  type StarPromptState,
} from "../lib/starPrompt";

/** The calm moment must hold this long before the card appears. */
const SETTLE_MS = 5000;

/**
 * `calm` is true while nothing else needs the user: a repository is loaded and no error, dialog,
 * merge or boot screen is up. The card shows once `calm` has held for SETTLE_MS.
 */
export function useStarPrompt(calm: boolean) {
  const [state, setState] = usePersistedState<StarPromptState>(
    STORAGE_KEYS.starPrompt,
    initialStarState(Date.now()),
  );
  const [visible, setVisible] = useState(false);
  const counted = useRef(false);

  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    setState(recordLaunch);
  }, [setState]);

  const eligible = shouldPrompt(state, Date.now());
  useEffect(() => {
    if (!calm || !eligible) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [calm, eligible]);

  return {
    visible,
    star: () => {
      openExternal(GITHUB_URL);
      setState(markDone);
      setVisible(false);
    },
    later: () => {
      setState((s) => dismissLater(s, Date.now()));
      setVisible(false);
    },
    never: () => {
      setState(markDone);
      setVisible(false);
    },
  };
}
