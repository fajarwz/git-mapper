// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { CreateBranchDialog } from "./CreateBranchDialog";

afterEach(() => {
  cleanup();
});

test("a free name creates the branch and checks it out by default", async () => {
  const onCreate = vi.fn();
  const { getByLabelText, getByRole } = render(
    <CreateBranchDialog hash="abcdef1234" exists={async () => false} onCreate={onCreate} onClose={vi.fn()} />,
  );
  fireEvent.change(getByLabelText("Branch name"), { target: { value: " topic " } });
  fireEvent.click(getByRole("button", { name: "Create branch" }));
  await waitFor(() => assert.equal(onCreate.mock.calls.length, 1));
  assert.deepEqual(onCreate.mock.calls[0], ["topic", true]);
});

test("the checkout box can be cleared, and a taken name shows an inline error instead of creating", async () => {
  const onCreate = vi.fn();
  const { getByLabelText, getByRole, findByRole } = render(
    <CreateBranchDialog
      hash="abcdef1234"
      exists={async (name) => name === "main"}
      onCreate={onCreate}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(getByLabelText("Check out the new branch"));
  fireEvent.change(getByLabelText("Branch name"), { target: { value: "main" } });
  fireEvent.click(getByRole("button", { name: "Create branch" }));
  const alert = await findByRole("alert");
  assert.match(alert.textContent ?? "", /already exists/);
  assert.equal(onCreate.mock.calls.length, 0);

  fireEvent.change(getByLabelText("Branch name"), { target: { value: "side" } });
  fireEvent.click(getByRole("button", { name: "Create branch" }));
  await waitFor(() => assert.equal(onCreate.mock.calls.length, 1));
  assert.deepEqual(onCreate.mock.calls[0], ["side", false]);
});
