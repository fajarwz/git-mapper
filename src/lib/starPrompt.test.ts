import assert from "node:assert/strict";
import { test } from "vitest";

import { dismissLater, initialStarState, markDone, recordLaunch, shouldPrompt } from "./starPrompt";

const DAY = 24 * 60 * 60 * 1000;

function launched(n: number, now = 0) {
  let state = initialStarState(now);
  for (let i = 0; i < n; i += 1) state = recordLaunch(state);
  return state;
}

test("waits for 3 days and 10 launches", () => {
  assert.equal(shouldPrompt(launched(10), 2 * DAY), false, "too early");
  assert.equal(shouldPrompt(launched(9), 4 * DAY), false, "too few launches");
  assert.equal(shouldPrompt(launched(10), 3 * DAY), true);
});

test("maybe later re-arms after 7 days, once", () => {
  const later = dismissLater(launched(10), 4 * DAY);
  assert.equal(shouldPrompt(later, 10 * DAY), false, "6 days after the ask");
  assert.equal(shouldPrompt(later, 11 * DAY), true, "7 days after the ask");
  const second = dismissLater(later, 11 * DAY);
  assert.equal(second.status, "done");
  assert.equal(shouldPrompt(second, 99 * DAY), false, "two asks is the cap");
});

test("starring or opting out is permanent", () => {
  assert.equal(shouldPrompt(markDone(launched(10)), 30 * DAY), false);
});
