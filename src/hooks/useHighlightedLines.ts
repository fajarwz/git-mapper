import { useEffect, useState } from "react";

import { highlightSync, languageForPath, loadHighlighter } from "../lib/highlight";

/**
 * Highlighted HTML per line, filled once the file's grammar has loaded. Rows render plain
 * until then, and a file whose language we do not know just stays plain forever. `texts` must
 * be memoized by the caller: a new array re-runs the load.
 */
export function useHighlightedLines(path: string, texts: string[]): string[] | null {
  const [highlighted, setHighlighted] = useState<string[] | null>(null);
  useEffect(() => {
    setHighlighted(null);
    const language = languageForPath(path);
    if (!language || texts.length === 0) return;
    let cancelled = false;
    void (async () => {
      const ready = await loadHighlighter(language);
      if (cancelled || !ready) return;
      setHighlighted(texts.map((text) => highlightSync(text, language) ?? ""));
    })();
    return () => {
      cancelled = true;
    };
  }, [path, texts]);
  return highlighted;
}
