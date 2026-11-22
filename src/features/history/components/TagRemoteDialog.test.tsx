// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import type { RemoteInfo } from "../../../types";
import { TagRemoteDialog, TagRemoteMode } from "./TagRemoteDialog";

afterEach(() => {
  cleanup();
});

const REMOTES: RemoteInfo[] = [
  { name: "fork", url: "https://x/f.git" },
  { name: "origin", url: "https://x/a.git" },
];

test("preselects origin and submits the remote you pick", async () => {
  const onSubmit = vi.fn(async () => {});
  const { findByRole, getByLabelText, getByRole } = render(
    <TagRemoteDialog mode={TagRemoteMode.Push} tag="v1" load={async () => REMOTES} onSubmit={onSubmit} onClose={vi.fn()} />,
  );
  await findByRole("option", { name: "fork" });
  assert.equal((getByLabelText("Remote") as HTMLSelectElement).value, "origin");
  fireEvent.change(getByLabelText("Remote"), { target: { value: "fork" } });
  fireEvent.click(getByRole("button", { name: "Push tag" }));
  await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1));
  assert.deepEqual(onSubmit.mock.calls[0], ["fork"]);
});

test("without an origin it preselects the first remote, and a failure shows inline", async () => {
  const onSubmit = vi.fn(async () => {
    throw new Error("remote rejected the delete");
  });
  const { findByRole, getByLabelText, getByRole } = render(
    <TagRemoteDialog
      mode={TagRemoteMode.Delete}
      tag="v1"
      load={async () => [{ name: "mirror", url: "https://x/m.git" }]}
      onSubmit={onSubmit}
      onClose={vi.fn()}
    />,
  );
  await findByRole("option", { name: "mirror" });
  assert.equal((getByLabelText("Remote") as HTMLSelectElement).value, "mirror");
  fireEvent.click(getByRole("button", { name: "Delete tag" }));
  const alert = await findByRole("alert");
  assert.match(alert.textContent ?? "", /rejected/);
});

test("a repository without remotes says so", async () => {
  const { findByText, queryByLabelText } = render(
    <TagRemoteDialog mode={TagRemoteMode.Push} tag="v1" load={async () => []} onSubmit={vi.fn()} onClose={vi.fn()} />,
  );
  await findByText(/no remotes/);
  assert.equal(queryByLabelText("Remote"), null);
});
