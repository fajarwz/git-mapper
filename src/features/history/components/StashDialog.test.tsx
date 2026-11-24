// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { StashDialog } from "./StashDialog";

afterEach(cleanup);

test("stashes with the trimmed name", () => {
  const onStash = vi.fn();
  const { getByLabelText, getByRole } = render(<StashDialog onStash={onStash} onClose={vi.fn()} />);
  fireEvent.change(getByLabelText(/name/i), { target: { value: "  parked  " } });
  fireEvent.click(getByRole("button", { name: "Stash" }));
  assert.deepEqual(onStash.mock.calls, [["parked"]]);
});

test("a blank name is allowed and sent empty", () => {
  const onStash = vi.fn();
  const { getByRole } = render(<StashDialog onStash={onStash} onClose={vi.fn()} />);
  fireEvent.click(getByRole("button", { name: "Stash" }));
  assert.deepEqual(onStash.mock.calls, [[""]]);
});
