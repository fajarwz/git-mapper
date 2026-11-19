// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { TabSwitcher } from "./TabSwitcher";
import type { SwitcherTab } from "./tabShortcuts";

const tabs: SwitcherTab[] = [
  { id: "a", name: "alpha", path: "C:\\code\\alpha", number: 1 },
  { id: "b", name: "beta", path: "C:\\code\\beta", number: 2 },
  { id: "c", name: "gamma", path: "C:\\work\\gamma", number: 3 },
];

afterEach(cleanup);

function setup() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(<TabSwitcher tabs={tabs} activeId="a" onSelect={onSelect} onClose={onClose} />);
  const input = screen.getByRole("combobox");
  return { onSelect, onClose, input };
}

test("lists every tab with its number and marks the current one", () => {
  setup();
  expect(screen.getAllByRole("option")).toHaveLength(3);
  expect(screen.getByText("current")).toBeTruthy();
});

test("typing filters and Enter selects the first match", () => {
  const { input, onSelect, onClose } = setup();
  fireEvent.change(input, { target: { value: "gam" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSelect).toHaveBeenCalledWith("c");
  expect(onClose).toHaveBeenCalled();
});

test("typing a tab number jumps to that tab", () => {
  const { input, onSelect } = setup();
  fireEvent.change(input, { target: { value: "2" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSelect).toHaveBeenCalledWith("b");
});

test("arrow keys move the highlight and wrap", () => {
  const { input, onSelect } = setup();
  fireEvent.keyDown(input, { key: "ArrowUp" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSelect).toHaveBeenCalledWith("c");
});

test("Enter with no match selects nothing", () => {
  const { input, onSelect } = setup();
  fireEvent.change(input, { target: { value: "zzz" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByText("No matching tab")).toBeTruthy();
});

test("Escape closes without selecting", () => {
  vi.useFakeTimers();
  const { input, onSelect, onClose } = setup();
  fireEvent.keyDown(input, { key: "Escape" });
  vi.runAllTimers();
  vi.useRealTimers();
  expect(onClose).toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});

test("clicking a row selects it", () => {
  const { onSelect } = setup();
  fireEvent.click(screen.getByText("beta"));
  expect(onSelect).toHaveBeenCalledWith("b");
});
