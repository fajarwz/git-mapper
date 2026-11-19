// Back/forward hook: coalescing, replay without re-recording, keyboard and mouse input.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, test, vi } from "vitest";

import { NAV_COALESCE_MS, useNavigationHistory } from "./useNavigationHistory";
import type { NavLocation } from "../../shared/lib/navigationHistory";

const at = (repoId: string, commitHash: string, filePath: string | null = null): NavLocation => ({
  repoId,
  commitHash,
  filePath,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(valid: (location: NavLocation) => boolean = () => true) {
  const navigate = vi.fn<(location: NavLocation) => void>();
  const hook = renderHook(
    ({ current }: { current: NavLocation | null }) =>
      useNavigationHistory({ current, navigate, isValid: valid }),
    { initialProps: { current: at("a", "1") as NavLocation | null } },
  );
  const settle = () => act(() => void vi.advanceTimersByTime(NAV_COALESCE_MS + 1));
  const visit = (location: NavLocation) => {
    hook.rerender({ current: location });
    settle();
  };
  return { hook, navigate, settle, visit };
}

test("rapid selection changes collapse into the one that settled", () => {
  const { hook, navigate, settle } = setup();
  settle();
  hook.rerender({ current: at("a", "2") });
  hook.rerender({ current: at("a", "3") });
  hook.rerender({ current: at("a", "4") });
  settle();
  act(() => hook.result.current.goBack());
  assert.deepEqual(navigate.mock.calls[0][0], at("a", "1"));
  assert.equal(hook.result.current.canGoBack, false, "only two entries: the first and the settled one");
});

test("going back replays the previous place and does not record the replay", () => {
  const { hook, navigate, visit } = setup();
  act(() => void vi.advanceTimersByTime(NAV_COALESCE_MS + 1));
  visit(at("b", "9", "x.ts"));
  assert.equal(hook.result.current.canGoBack, true);

  act(() => hook.result.current.goBack());
  assert.deepEqual(navigate.mock.calls[0][0], at("a", "1"));

  // The app applies the location, so the selection now matches it.
  visit(at("a", "1"));
  assert.equal(hook.result.current.canGoBack, false);
  assert.equal(hook.result.current.canGoForward, true);

  act(() => hook.result.current.goForward());
  assert.deepEqual(navigate.mock.calls[1][0], at("b", "9", "x.ts"));
});

test("a pending selection is recorded before stepping back", () => {
  const { hook, navigate, settle } = setup();
  settle();
  hook.rerender({ current: at("a", "2") });
  // Back pressed before the selection settled: it must still be on the list.
  act(() => hook.result.current.goBack());
  assert.deepEqual(navigate.mock.calls[0][0], at("a", "1"));
  assert.equal(hook.result.current.canGoForward, true);
});

test("Alt+Left and Alt+Right step; plain arrows do not", () => {
  const { hook, navigate, visit, settle } = setup();
  settle();
  visit(at("a", "2"));
  act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" })));
  assert.equal(navigate.mock.calls.length, 0);
  act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true })));
  assert.deepEqual(navigate.mock.calls[0][0], at("a", "1"));
  visit(at("a", "1"));
  act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true })));
  assert.deepEqual(navigate.mock.calls[1][0], at("a", "2"));
  assert.equal(hook.result.current.canGoBack, true);
});

test("the mouse side buttons step back and forward", () => {
  const { navigate, visit, settle } = setup();
  settle();
  visit(at("a", "2"));
  act(() => void window.dispatchEvent(new MouseEvent("mouseup", { button: 3 })));
  assert.deepEqual(navigate.mock.calls[0][0], at("a", "1"));
});

test("entries that no longer exist are skipped", () => {
  const { hook, navigate, visit, settle } = setup((location) => location.repoId !== "closed");
  settle();
  visit(at("closed", "5"));
  visit(at("a", "3"));
  act(() => hook.result.current.goBack());
  assert.deepEqual(navigate.mock.calls[0][0], at("a", "1"));
});

test("nothing is recorded while no commit is selected", () => {
  const { hook, settle } = setup();
  hook.rerender({ current: null });
  settle();
  assert.equal(hook.result.current.canGoBack, false);
});
