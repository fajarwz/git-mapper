// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import type { RemoteInfo } from "../../../types";
import { UpstreamDialog, UpstreamMode } from "./UpstreamDialog";

afterEach(() => {
  cleanup();
});

const REMOTES: RemoteInfo[] = [
  { name: "origin", url: "https://x/a.git" },
  { name: "mirror", url: "https://x/m.git" },
];

test("submits the chosen remote and the branch name, which defaults to the local one", async () => {
  const onSubmit = vi.fn(async () => {});
  const { findByRole, getByLabelText, getByRole } = render(
    <UpstreamDialog
      mode={UpstreamMode.Push}
      branch="topic"
      defaultRemote="origin"
      load={async () => REMOTES}
      onSubmit={onSubmit}
      onClose={vi.fn()}
    />,
  );
  await findByRole("option", { name: "mirror" });
  fireEvent.change(getByLabelText("Remote"), { target: { value: "mirror" } });
  fireEvent.click(getByRole("button", { name: "Push" }));
  await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1));
  assert.deepEqual(onSubmit.mock.calls[0], ["mirror", "topic"]);
});

test("a refusal shows inline and leaves the dialog usable", async () => {
  const onSubmit = vi.fn(async () => {
    throw new Error('"origin/nope" does not exist; fetch or push it first');
  });
  const { findByRole, getByLabelText, getByRole } = render(
    <UpstreamDialog
      mode={UpstreamMode.Set}
      branch="topic"
      defaultRemote="origin"
      load={async () => REMOTES}
      onSubmit={onSubmit}
      onClose={vi.fn()}
    />,
  );
  await findByRole("option", { name: "origin" });
  fireEvent.change(getByLabelText("Remote branch"), { target: { value: "nope" } });
  fireEvent.click(getByRole("button", { name: "Set upstream" }));
  const alert = await findByRole("alert");
  assert.match(alert.textContent ?? "", /does not exist/);
  assert.equal((getByRole("button", { name: "Set upstream" }) as HTMLButtonElement).disabled, false);
});

test("a repository without remotes says so instead of offering a picker", async () => {
  const { findByText, queryByLabelText } = render(
    <UpstreamDialog
      mode={UpstreamMode.Set}
      branch="topic"
      defaultRemote="origin"
      load={async () => []}
      onSubmit={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await findByText(/no remotes/);
  assert.equal(queryByLabelText("Remote"), null);
});
