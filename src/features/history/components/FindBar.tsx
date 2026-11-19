import { useEffect, useRef } from "react";
import { useExit } from "../../../shared/lib/useExit";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, SearchIcon } from "../../../shared/components/icons";

export interface FindState {
  query: string;
  onQueryChange: (query: string) => void;
  matches: string[];
  activeIndex: number;
  onStep: (delta: number) => void;
  onClose: () => void;
  loadedCount: number;
  /** False while older history is still unread: a miss only speaks for the loaded rows. */
  allLoaded: boolean;
  focusToken: number;
}

const STEP_BUTTON =
  "grid size-6 place-items-center rounded-md text-ink-dim hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-dim";

/**
 * The VS Code-style find widget: a floating glass bar over the top-right of the history
 * list. Enter / Shift+Enter step through the matches, Esc closes it (and drops the
 * highlight). It reports its scope honestly — "N loaded" — because a search that finds
 * nothing in the loaded window says nothing about older commits.
 */
export function FindBar({ find }: { find: FindState }) {
  const { query, matches, activeIndex, loadedCount, allLoaded, focusToken } = find;
  const inputRef = useRef<HTMLInputElement>(null);
  // Esc and the close button play the exit before the App unmounts the bar.
  const { leaving, close } = useExit(find.onClose);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const searching = query.trim() !== "";
  const scope = allLoaded ? "" : ` · ${loadedCount.toLocaleString("en-US")} loaded`;
  const status = !searching
    ? ""
    : matches.length === 0
      ? `No results${scope}`
      : `${activeIndex + 1} of ${matches.length}${scope}`;

  return (
    <div
      data-find-bar
      role="search"
      className={`absolute right-4 top-10 z-20 flex items-center gap-1 rounded-lg border border-primary-ink/40 bg-surface p-1 pl-2 shadow-lg ring-1 ring-black/5 ${leaving ? "pop-out" : "pop-in-bar"}`}
    >
      <span aria-hidden="true" className="text-primary-ink">
        <SearchIcon size={12} />
      </span>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => find.onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if (event.key === "Enter") {
            event.preventDefault();
            find.onStep(event.shiftKey ? -1 : 1);
          }
        }}
        aria-label="Find in history"
        placeholder="Find in history"
        title="Search hashes, messages, authors and refs. Enter: next, Shift+Enter: previous, Esc: close"
        className="h-6 w-44 bg-transparent px-1 text-[12.5px] text-ink outline-none placeholder:text-ink-dim"
      />
      <span
        data-find-status
        aria-live="polite"
        className={`min-w-0 whitespace-nowrap px-1 text-[11.5px] ${
          searching && matches.length === 0 ? "text-danger" : "text-ink-dim"
        }`}
      >
        {status}
      </span>
      <button
        type="button"
        onClick={() => find.onStep(-1)}
        disabled={matches.length === 0}
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        className={STEP_BUTTON}
      >
        <ArrowUpIcon size={11} />
      </button>
      <button
        type="button"
        onClick={() => find.onStep(1)}
        disabled={matches.length === 0}
        aria-label="Next match"
        title="Next match (Enter)"
        className={STEP_BUTTON}
      >
        <ArrowDownIcon size={11} />
      </button>
      <button type="button" onClick={close} aria-label="Close find" title="Close (Esc)" className={STEP_BUTTON}>
        <CloseIcon size={9} />
      </button>
    </div>
  );
}
