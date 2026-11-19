import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { PANEL } from "../../shared/lib/ui";
import { useExit } from "../../shared/lib/useExit";
import { filterTabs, type SwitcherTab } from "./tabShortcuts";

interface TabSwitcherProps {
  tabs: SwitcherTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** Ctrl+P palette: type a name, path fragment or tab number, Enter jumps. Scales past what Ctrl+1..9 reach. */
export function TabSwitcher({ tabs, activeId, onSelect, onClose }: TabSwitcherProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { leaving, close } = useExit(onClose);

  const matches = useMemo(() => filterTabs(tabs, query), [tabs, query]);
  const active = Math.min(cursor, Math.max(matches.length - 1, 0));

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  function choose(id: string) {
    onSelect(id);
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      if (matches.length) setCursor((active + 1) % matches.length);
    } else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      if (matches.length) setCursor((active - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = matches[active];
      if (target) choose(target.id);
    }
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-40 grid place-items-start justify-items-center bg-scrim p-6 pt-[14vh] backdrop-blur-md ${leaving ? "fade-out" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Switch tab"
        className={`${PANEL} w-full max-w-lg overflow-hidden ${leaving ? "pop-out" : "pop-in"}`}
      >
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls="tab-switcher-list"
          aria-activedescendant={matches[active] ? `tab-switcher-${matches[active].id}` : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Go to a tab by name or number"
          spellCheck={false}
          autoComplete="off"
          className="w-full border-0 border-b border-hairline bg-transparent px-4 py-3 text-[14px] text-ink outline-none placeholder:text-ink-soft"
        />
        <ul
          id="tab-switcher-list"
          ref={listRef}
          role="listbox"
          className="m-0 max-h-[50vh] list-none overflow-y-auto p-1.5"
        >
          {matches.map((tab, index) => (
            <li
              key={tab.id}
              id={`tab-switcher-${tab.id}`}
              role="option"
              aria-selected={index === active}
              onMouseMove={() => setCursor(index)}
              onClick={() => choose(tab.id)}
              className={`flex cursor-pointer items-baseline gap-3 rounded-lg px-3 py-2 ${
                index === active ? "bg-hover-glass" : ""
              }`}
            >
              <span className="w-6 shrink-0 text-right text-[11.5px] tabular-nums text-ink-soft">
                {tab.number}
              </span>
              <span className="shrink-0 text-[13px] font-semibold text-ink">{tab.name}</span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-soft">{tab.path}</span>
              {tab.id === activeId && (
                <span className="shrink-0 text-[11px] font-semibold text-primary">current</span>
              )}
            </li>
          ))}
          {matches.length === 0 && (
            <li className="px-3 py-6 text-center text-[12.5px] text-ink-soft">No matching tab</li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
