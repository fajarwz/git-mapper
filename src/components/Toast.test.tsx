// The failure toast: title/detail render, the close button, and the self-dismiss timer.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { Toast } from "./Toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("Toast shows the title and detail and closes on the button", () => {
  let closed = 0;
  const { container } = render(
    <Toast
      title="Could not open that folder"
      detail="C:/plain is not a Git repository"
      onClose={() => {
        closed += 1;
      }}
    />,
  );
  const toast = container.querySelector("[data-toast]") as HTMLElement;
  assert.ok(toast.textContent?.includes("Could not open that folder"));
  assert.ok(toast.textContent?.includes("is not a Git repository"));
  fireEvent.click(container.querySelector("[aria-label='Dismiss notice']") as HTMLElement);
  assert.equal(closed, 1, "the close button dismisses the notice");
});

test("Toast dismisses itself after six seconds", () => {
  vi.useFakeTimers();
  let closed = 0;
  const { unmount } = render(
    <Toast
      title="A saved repository could not be reopened"
      onClose={() => {
        closed += 1;
      }}
    />,
  );
  vi.advanceTimersByTime(5999);
  assert.equal(closed, 0, "it stays up for the read");
  vi.advanceTimersByTime(1);
  assert.equal(closed, 1, "the timer closes it at six seconds");
  unmount();
});
