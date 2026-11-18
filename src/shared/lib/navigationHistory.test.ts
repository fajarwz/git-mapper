// Back/forward history: push, truncate, dedupe, cap, and stepping past dead entries.
import assert from "node:assert/strict";
import { test } from "vitest";

import {
  EMPTY_NAV_HISTORY,
  NAV_HISTORY_CAP,
  canGoBack,
  canGoForward,
  pushLocation,
  stepHistory,
  type NavHistory,
  type NavLocation,
} from "./navigationHistory";

const at = (repoId: string, commitHash: string, filePath: string | null = null): NavLocation => ({
  repoId,
  commitHash,
  filePath,
});
const build = (...locations: NavLocation[]): NavHistory =>
  locations.reduce(pushLocation, EMPTY_NAV_HISTORY);
const always = () => true;

test("an empty history can go nowhere", () => {
  assert.equal(canGoBack(EMPTY_NAV_HISTORY), false);
  assert.equal(canGoForward(EMPTY_NAV_HISTORY), false);
  assert.equal(stepHistory(EMPTY_NAV_HISTORY, -1, always), null);
});

test("pushing appends and moves to the newest entry", () => {
  const history = build(at("a", "1"), at("a", "2"), at("b", "9"));
  assert.equal(history.entries.length, 3);
  assert.equal(history.index, 2);
  assert.equal(canGoBack(history), true);
  assert.equal(canGoForward(history), false);
});

test("landing on the current place is not a new entry", () => {
  const history = build(at("a", "1"), at("a", "1"));
  assert.equal(history.entries.length, 1);
});

test("the same commit with a different file is its own entry", () => {
  const history = build(at("a", "1"), at("a", "1", "x.ts"));
  assert.equal(history.entries.length, 2);
});

test("back then forward walks the list and stops at the ends", () => {
  const history = build(at("a", "1"), at("a", "2"), at("a", "3"));
  const back = stepHistory(history, -1, always);
  assert.deepEqual(back?.location, at("a", "2"));
  const back2 = stepHistory(back!.history, -1, always);
  assert.deepEqual(back2?.location, at("a", "1"));
  assert.equal(stepHistory(back2!.history, -1, always), null);
  const forward = stepHistory(back2!.history, 1, always);
  assert.deepEqual(forward?.location, at("a", "2"));
});

test("navigating after going back drops the forward entries", () => {
  const history = build(at("a", "1"), at("a", "2"), at("a", "3"));
  const back = stepHistory(history, -1, always)!.history;
  const next = pushLocation(back, at("a", "7"));
  assert.deepEqual(
    next.entries.map((entry) => entry.commitHash),
    ["1", "2", "7"],
  );
  assert.equal(canGoForward(next), false);
});

test("stepping skips entries that no longer exist", () => {
  const history = build(at("a", "1"), at("closed", "5"), at("a", "3"));
  const result = stepHistory(history, -1, (location) => location.repoId !== "closed");
  assert.deepEqual(result?.location, at("a", "1"));
  assert.equal(result?.history.index, 0);
});

test("stepping returns null when every entry in that direction is dead", () => {
  const history = build(at("closed", "1"), at("a", "2"));
  assert.equal(stepHistory(history, -1, (location) => location.repoId !== "closed"), null);
});

test("the oldest entries fall off past the cap", () => {
  let history = EMPTY_NAV_HISTORY;
  for (let i = 0; i < NAV_HISTORY_CAP + 10; i += 1) history = pushLocation(history, at("a", String(i)));
  assert.equal(history.entries.length, NAV_HISTORY_CAP);
  assert.equal(history.entries[0].commitHash, "10");
  assert.equal(history.index, NAV_HISTORY_CAP - 1);
});
