import { useEffect, useRef } from "react";

export enum TabShortcut {
  Select = "select",
  SelectLast = "select-last",
  Next = "next",
  Previous = "previous",
  New = "new",
  Close = "close",
  Switcher = "switcher",
}

export type TabShortcutAction =
  | { kind: TabShortcut.Select; index: number }
  | { kind: Exclude<TabShortcut, TabShortcut.Select> };

type KeyEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Ctrl+1..8 pick a tab, Ctrl+9 the last (as in Chrome); Ctrl+Tab cycles; T/W/P open, close, search. */
export function tabShortcutAction(event: KeyEvent): TabShortcutAction | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (event.key === "Tab") {
    return { kind: event.shiftKey ? TabShortcut.Previous : TabShortcut.Next };
  }
  if (event.shiftKey) return null;
  if (event.key >= "1" && event.key <= "8") return { kind: TabShortcut.Select, index: Number(event.key) - 1 };
  if (event.key === "9") return { kind: TabShortcut.SelectLast };
  switch (event.key.toLowerCase()) {
    case "t":
      return { kind: TabShortcut.New };
    case "w":
      return { kind: TabShortcut.Close };
    case "p":
      return { kind: TabShortcut.Switcher };
    default:
      return null;
  }
}

/** The index a selecting shortcut lands on, or null when it has nowhere to go. Cycling wraps. */
export function targetTabIndex(action: TabShortcutAction, count: number, current: number): number | null {
  if (count === 0) return null;
  switch (action.kind) {
    case TabShortcut.Select:
      return action.index < count ? action.index : null;
    case TabShortcut.SelectLast:
      return count - 1;
    case TabShortcut.Next:
      return (Math.max(current, 0) + 1) % count;
    case TabShortcut.Previous:
      return (Math.max(current, 0) - 1 + count) % count;
    default:
      return null;
  }
}

interface TabShortcutHandlers {
  /** Off while a dialog or menu owns the keyboard. */
  enabled: boolean;
  count: number;
  activeIndex: number;
  onSelectIndex: (index: number) => void;
  onNew: () => void;
  onClose: () => void;
  onSwitcher: () => void;
}

export function useTabShortcuts(handlers: TabShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const action = tabShortcutAction(event);
      if (!action) return;
      const { enabled, count, activeIndex, onSelectIndex, onNew, onClose, onSwitcher } = ref.current;
      if (!enabled) return;
      event.preventDefault();
      switch (action.kind) {
        case TabShortcut.New:
          onNew();
          return;
        case TabShortcut.Close:
          if (count > 0) onClose();
          return;
        case TabShortcut.Switcher:
          if (count > 0) onSwitcher();
          return;
        default: {
          const target = targetTabIndex(action, count, activeIndex);
          if (target !== null && target !== activeIndex) onSelectIndex(target);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

export interface SwitcherTab {
  id: string;
  name: string;
  path: string;
  number: number;
}

/** Digits narrow by tab number (so "12" finds the twelfth tab); anything else matches name or path. */
export function filterTabs(tabs: SwitcherTab[], query: string): SwitcherTab[] {
  const text = query.trim().toLowerCase();
  if (!text) return tabs;
  if (/^\d+$/.test(text)) return tabs.filter((tab) => String(tab.number).startsWith(text));
  return tabs.filter(
    (tab) => tab.name.toLowerCase().includes(text) || tab.path.toLowerCase().includes(text),
  );
}
