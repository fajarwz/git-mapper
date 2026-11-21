// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { CheckoutRemoteDialog } from "./CheckoutRemoteDialog";
import { RemoteCheckoutMode } from "../../../types";

afterEach(() => {
  cleanup();
});

test("a free name creates the local branch, prefilled from the remote's own name", async () => {
  const onCheckout = vi.fn();
  const { getByLabelText, getByRole } = render(
    <CheckoutRemoteDialog
      remoteRef="origin/feature/x"
      exists={async () => false}
      onCheckout={onCheckout}
      onClose={vi.fn()}
    />,
  );
  const input = getByLabelText("Name of the new local branch") as HTMLInputElement;
  assert.equal(input.value, "feature/x");

  fireEvent.change(input, { target: { value: "  my-x " } });
  fireEvent.click(getByRole("button", { name: "Check out" }));
  await waitFor(() => assert.equal(onCheckout.mock.calls.length, 1));
  assert.deepEqual(onCheckout.mock.calls[0], ["my-x", RemoteCheckoutMode.Create]);
});

test("a taken name offers the existing branch or another name", async () => {
  const onCheckout = vi.fn();
  const { getByLabelText, getByRole, findByRole } = render(
    <CheckoutRemoteDialog
      remoteRef="origin/feature/x"
      exists={async (name) => name === "feature/x"}
      onCheckout={onCheckout}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(getByRole("button", { name: "Check out" }));
  const existing = await findByRole("button", { name: "Check out existing & pull" });
  assert.equal(onCheckout.mock.calls.length, 0, "nothing runs until the user chooses");

  fireEvent.click(getByRole("button", { name: "Use another name" }));
  const input = getByLabelText("Name of the new local branch") as HTMLInputElement;
  assert.equal(input.value, "feature/x", "the name stays for editing");

  fireEvent.change(input, { target: { value: "feature/x2" } });
  fireEvent.click(getByRole("button", { name: "Check out" }));
  await waitFor(() => assert.equal(onCheckout.mock.calls.length, 1));
  assert.deepEqual(onCheckout.mock.calls[0], ["feature/x2", RemoteCheckoutMode.Create]);

  fireEvent.change(getByLabelText("Name of the new local branch"), { target: { value: "feature/x" } });
  fireEvent.click(getByRole("button", { name: "Check out" }));
  fireEvent.click(await findByRole("button", { name: "Check out existing & pull" }));
  assert.deepEqual(onCheckout.mock.calls[1], ["feature/x", RemoteCheckoutMode.Existing]);
  assert.ok(existing);
});
