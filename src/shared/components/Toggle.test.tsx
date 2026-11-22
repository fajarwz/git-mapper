// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { Toggle } from "./Toggle";

afterEach(() => {
  cleanup();
});

test("a toggle is a switch that reports the opposite of its state when clicked", () => {
  const onChange = vi.fn();
  const { getByRole } = render(<Toggle checked={false} onChange={onChange} label="Show avatars" />);
  const control = getByRole("switch", { name: "Show avatars" });
  assert.equal(control.getAttribute("aria-checked"), "false");
  fireEvent.click(control);
  assert.deepEqual(onChange.mock.calls[0], [true]);
});

test("a checked toggle turns off, and a disabled one does nothing", () => {
  const onChange = vi.fn();
  const on = render(<Toggle checked onChange={onChange} label="Auto" />);
  fireEvent.click(on.getByRole("switch"));
  assert.deepEqual(onChange.mock.calls[0], [false]);
  cleanup();

  const off = render(<Toggle checked disabled onChange={onChange} label="Locked" />);
  fireEvent.click(off.getByRole("switch"));
  assert.equal(onChange.mock.calls.length, 1);
});
