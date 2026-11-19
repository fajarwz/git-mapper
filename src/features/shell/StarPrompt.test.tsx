// The star card: its three actions and Esc (which counts as "later").
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, test, vi } from "vitest";

import { StarPrompt } from "./StarPrompt";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(last = false) {
  const calls: string[] = [];
  render(
    <StarPrompt
      onStar={() => calls.push("star")}
      onLater={() => calls.push("later")}
      last={last}
    />,
  );
  return calls;
}

test("each action reports itself", () => {
  const calls = setup();
  fireEvent.click(screen.getByRole("button", { name: "Star on GitHub" }));
  assert.deepEqual(calls, ["star"], "starring reports at once");
  fireEvent.click(screen.getByRole("button", { name: "Later" }));
  vi.advanceTimersByTime(150);
  assert.deepEqual(calls, ["star", "later"], "later reports once the card has faded");
});

test("Esc and the close button count as later", () => {
  let calls = setup();
  fireEvent.keyDown(window, { key: "Escape" });
  vi.advanceTimersByTime(150);
  assert.deepEqual(calls, ["later"]);
  cleanup();
  calls = setup();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
  vi.advanceTimersByTime(150);
  assert.deepEqual(calls, ["later"]);
});

test("only the final ask says so", () => {
  setup();
  assert.equal(screen.queryByText(/Last time/), null);
  cleanup();
  setup(true);
  assert.ok(screen.getByText(/Last time we'll ask/));
});
