export enum Shortcut {
  NewTab = "new-tab",
  CloseTab = "close-tab",
  SelectTab = "select-tab",
  LastTab = "last-tab",
  CycleTab = "cycle-tab",
  TabSwitcher = "tab-switcher",
  Find = "find",
  Back = "back",
  Forward = "forward",
  Commit = "commit",
  Zoom = "zoom",
}

export enum ShortcutGroup {
  Tabs = "Tabs",
  Navigate = "Navigate",
  Commit = "Commit",
  View = "View",
}

interface ShortcutInfo {
  group: ShortcutGroup;
  keys: string[];
  label: string;
}

/** The one place keys are written for display: Settings and every tooltip read from here. */
export const SHORTCUTS: Record<Shortcut, ShortcutInfo> = {
  [Shortcut.NewTab]: { group: ShortcutGroup.Tabs, keys: ["Ctrl", "T"], label: "Open a repository in a new tab" },
  [Shortcut.CloseTab]: { group: ShortcutGroup.Tabs, keys: ["Ctrl", "W"], label: "Close the current tab" },
  [Shortcut.SelectTab]: { group: ShortcutGroup.Tabs, keys: ["Ctrl", "1–8"], label: "Go to that tab" },
  [Shortcut.LastTab]: { group: ShortcutGroup.Tabs, keys: ["Ctrl", "9"], label: "Go to the last tab" },
  [Shortcut.CycleTab]: { group: ShortcutGroup.Tabs, keys: ["Ctrl", "Tab"], label: "Next tab (add Shift for previous)" },
  [Shortcut.TabSwitcher]: { group: ShortcutGroup.Tabs, keys: ["Ctrl", "P"], label: "Find a tab by name or number" },
  [Shortcut.Find]: { group: ShortcutGroup.Navigate, keys: ["Ctrl", "F"], label: "Search the loaded history" },
  [Shortcut.Back]: { group: ShortcutGroup.Navigate, keys: ["Alt", "←"], label: "Back to the previous selection" },
  [Shortcut.Forward]: { group: ShortcutGroup.Navigate, keys: ["Alt", "→"], label: "Forward again" },
  [Shortcut.Commit]: { group: ShortcutGroup.Commit, keys: ["Ctrl", "Enter"], label: "Commit the staged files" },
  [Shortcut.Zoom]: { group: ShortcutGroup.View, keys: ["Ctrl", "+ / − / 0"], label: "Zoom in, out, reset" },
};

export const withShortcut = (text: string, shortcut: Shortcut) => `${text} (${SHORTCUTS[shortcut].keys.join("+")})`;

export function shortcutGroups(): { group: ShortcutGroup; items: ShortcutInfo[] }[] {
  return Object.values(ShortcutGroup).map((group) => ({
    group,
    items: Object.values(SHORTCUTS).filter((info) => info.group === group),
  }));
}
