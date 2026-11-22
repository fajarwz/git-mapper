// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { CreateTagDialog } from "./CreateTagDialog";

afterEach(() => {
  cleanup();
});

test("a free name makes a lightweight tag with an empty message", async () => {
  const onCreate = vi.fn();
  const { getByLabelText, getByRole } = render(
    <CreateTagDialog hash="abcdef1234" exists={async () => false} onCreate={onCreate} onClose={vi.fn()} />,
  );
  fireEvent.change(getByLabelText("Tag name"), { target: { value: " v1.0 " } });
  fireEvent.click(getByRole("button", { name: "Create tag" }));
  await waitFor(() => assert.equal(onCreate.mock.calls.length, 1));
  assert.deepEqual(onCreate.mock.calls[0], ["v1.0", ""]);
});

test("an annotated tag needs a message, and a taken name shows an inline error", async () => {
  const onCreate = vi.fn();
  const { getByLabelText, getByRole, findByRole } = render(
    <CreateTagDialog
      hash="abcdef1234"
      exists={async (name) => name === "v1"}
      onCreate={onCreate}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(getByLabelText("Annotated tag"));
  fireEvent.change(getByLabelText("Tag name"), { target: { value: "v1" } });
  assert.equal((getByRole("button", { name: "Create tag" }) as HTMLButtonElement).disabled, true);

  fireEvent.change(getByLabelText("Tag message"), { target: { value: "first release" } });
  fireEvent.click(getByRole("button", { name: "Create tag" }));
  const alert = await findByRole("alert");
  assert.match(alert.textContent ?? "", /already exists/);
  assert.equal(onCreate.mock.calls.length, 0);

  fireEvent.change(getByLabelText("Tag name"), { target: { value: "v2" } });
  fireEvent.click(getByRole("button", { name: "Create tag" }));
  await waitFor(() => assert.equal(onCreate.mock.calls.length, 1));
  assert.deepEqual(onCreate.mock.calls[0], ["v2", "first release"]);
});
