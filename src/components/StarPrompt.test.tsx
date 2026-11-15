// The star card: its three actions and Esc (which counts as "later").
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { StarPrompt } from "./StarPrompt";

afterEach(cleanup);

function setup() {
  const calls: string[] = [];
  render(
    <StarPrompt
      onStar={() => calls.push("star")}
      onLater={() => calls.push("later")}
      onNever={() => calls.push("never")}
    />,
  );
  return calls;
}

test("each action reports itself", () => {
  const calls = setup();
  fireEvent.click(screen.getByRole("button", { name: "Star on GitHub" }));
  fireEvent.click(screen.getByRole("button", { name: "Later" }));
  fireEvent.click(screen.getByRole("button", { name: "Never" }));
  assert.deepEqual(calls, ["star", "later", "never"]);
});

test("Esc and the close button count as later", () => {
  const calls = setup();
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
  assert.deepEqual(calls, ["later", "later"]);
});
