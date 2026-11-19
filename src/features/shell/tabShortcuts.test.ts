// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  TabShortcut,
  filterTabs,
  tabShortcutAction,
  targetTabIndex,
  useTabShortcuts,
  type SwitcherTab,
} from "./tabShortcuts";

afterEach(cleanup);

const press =(key: string, mods: Partial<KeyboardEvent> = { ctrlKey: true }) =>
  tabShortcutAction({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test("Ctrl+1..8 select by position and Ctrl+9 means the last tab", () => {
  assert.deepEqual(press("1"), { kind: TabShortcut.Select, index: 0 });
  assert.deepEqual(press("8"), { kind: TabShortcut.Select, index: 7 });
  assert.deepEqual(press("9"), { kind: TabShortcut.SelectLast });
  assert.equal(press("0"), null);
});

test("Ctrl+Tab cycles forward and Ctrl+Shift+Tab backward", () => {
  assert.deepEqual(press("Tab"), { kind: TabShortcut.Next });
  assert.deepEqual(press("Tab", { ctrlKey: true, shiftKey: true }), { kind: TabShortcut.Previous });
});

test("T, W and P map to new, close and the switcher in either case", () => {
  assert.deepEqual(press("t"), { kind: TabShortcut.New });
  assert.deepEqual(press("W"), { kind: TabShortcut.Close });
  assert.deepEqual(press("p"), { kind: TabShortcut.Switcher });
});

test("bare keys, Alt chords and shifted letters are left alone", () => {
  assert.equal(press("1", {}), null);
  assert.equal(press("t", { ctrlKey: true, altKey: true }), null);
  assert.equal(press("t", { ctrlKey: true, shiftKey: true }), null);
  assert.equal(press("1", { ctrlKey: true, shiftKey: true }), null);
});

test("selecting past the last tab does nothing; cycling wraps", () => {
  assert.equal(targetTabIndex({ kind: TabShortcut.Select, index: 4 }, 3, 0), null);
  assert.equal(targetTabIndex({ kind: TabShortcut.Select, index: 2 }, 3, 0), 2);
  assert.equal(targetTabIndex({ kind: TabShortcut.SelectLast }, 5, 0), 4);
  assert.equal(targetTabIndex({ kind: TabShortcut.Next }, 3, 2), 0);
  assert.equal(targetTabIndex({ kind: TabShortcut.Previous }, 3, 0), 2);
  assert.equal(targetTabIndex({ kind: TabShortcut.Next }, 0, 0), null);
});

const tabs: SwitcherTab[] = Array.from({ length: 12 }, (_, i) => ({
  id: `r${i + 1}`,
  name: i === 11 ? "git-mapper" : `repo-${i + 1}`,
  path: `C:\\code\\${i === 11 ? "git-mapper" : `repo-${i + 1}`}`,
  number: i + 1,
}));

test("typing digits narrows by tab number, so 12 reaches the twelfth tab", () => {
  assert.deepEqual(filterTabs(tabs, "12").map((tab) => tab.number), [12]);
  assert.deepEqual(filterTabs(tabs, "1").map((tab) => tab.number), [1, 10, 11, 12]);
});

test("text matches the name or the path, ignoring case", () => {
  assert.deepEqual(filterTabs(tabs, "MAPPER").map((tab) => tab.number), [12]);
  assert.equal(filterTabs(tabs, "").length, 12);
  assert.equal(filterTabs(tabs, "nothing").length, 0);
});

function mount(overrides: Partial<Parameters<typeof useTabShortcuts>[0]> = {}) {
  const handlers = {
    enabled: true,
    count: 3,
    activeIndex: 0,
    onSelectIndex: vi.fn(),
    onNew: vi.fn(),
    onClose: vi.fn(),
    onSwitcher: vi.fn(),
    ...overrides,
  };
  renderHook(() => useTabShortcuts(handlers));
  return handlers;
}

const fire = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, ctrlKey: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
};

test("the hook routes each shortcut and swallows the browser default", () => {
  const handlers = mount();
  expect(fire("2").defaultPrevented).toBe(true);
  expect(handlers.onSelectIndex).toHaveBeenCalledWith(1);
  fire("Tab");
  expect(handlers.onSelectIndex).toHaveBeenLastCalledWith(1);
  fire("t");
  expect(handlers.onNew).toHaveBeenCalledTimes(1);
  fire("w");
  expect(handlers.onClose).toHaveBeenCalledTimes(1);
  fire("p");
  expect(handlers.onSwitcher).toHaveBeenCalledTimes(1);
});

test("selecting the tab that is already active is a no-op", () => {
  const handlers = mount();
  fire("1");
  expect(handlers.onSelectIndex).not.toHaveBeenCalled();
});

test("with no tabs open only New is live", () => {
  const handlers = mount({ count: 0 });
  fire("w");
  fire("p");
  fire("1");
  expect(handlers.onClose).not.toHaveBeenCalled();
  expect(handlers.onSwitcher).not.toHaveBeenCalled();
  expect(handlers.onSelectIndex).not.toHaveBeenCalled();
  fire("t");
  expect(handlers.onNew).toHaveBeenCalledTimes(1);
});

test("a dialog owning the keyboard disables every shortcut", () => {
  const handlers = mount({ enabled: false });
  const event = fire("t");
  expect(event.defaultPrevented).toBe(false);
  expect(handlers.onNew).not.toHaveBeenCalled();
});
