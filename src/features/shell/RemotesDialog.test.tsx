// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import type { RemoteInfo } from "../../types";
import { RemotesDialog } from "./RemotesDialog";

afterEach(() => {
  cleanup();
});

function setup(initial: RemoteInfo[], overrides: Partial<Parameters<typeof RemotesDialog>[0]> = {}) {
  let remotes = initial;
  const props = {
    load: vi.fn(async () => remotes),
    onAdd: vi.fn(async (name: string, url: string) => {
      remotes = [...remotes, { name, url }];
    }),
    onRename: vi.fn(async (name: string, next: string) => {
      remotes = remotes.map((remote) => (remote.name === name ? { ...remote, name: next } : remote));
    }),
    onRemove: vi.fn(async (name: string) => {
      remotes = remotes.filter((remote) => remote.name !== name);
    }),
    onClose: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<RemotesDialog {...props} />) };
}

test("lists the remotes and adds a new one, clearing the form", async () => {
  const { props, findByText, getByLabelText, getByRole } = setup([{ name: "origin", url: "https://x/a.git" }]);
  await findByText("origin");

  fireEvent.change(getByLabelText("Remote name"), { target: { value: " fork " } });
  fireEvent.change(getByLabelText("Remote URL"), { target: { value: " https://x/f.git " } });
  fireEvent.click(getByRole("button", { name: "Add" }));

  await findByText("fork");
  assert.deepEqual(props.onAdd.mock.calls[0], ["fork", "https://x/f.git"]);
  assert.equal((getByLabelText("Remote name") as HTMLInputElement).value, "");
});

test("renames inline and shows the backend's refusal as an alert", async () => {
  const { props, findByText, getByLabelText, getByRole, findByRole } = setup(
    [{ name: "origin", url: "https://x/a.git" }],
    {
      onRename: vi.fn(async () => {
        throw new Error('A remote named "taken" already exists');
      }),
    },
  );
  await findByText("origin");
  fireEvent.click(getByRole("button", { name: "Rename origin" }));
  fireEvent.change(getByLabelText("New name for origin"), { target: { value: "taken" } });
  fireEvent.click(getByRole("button", { name: "Save" }));

  const alert = await findByRole("alert");
  assert.match(alert.textContent ?? "", /already exists/);
  assert.equal(props.onRename.mock.calls.length, 1);
  assert.ok(getByLabelText("New name for origin"), "still editing after a refusal");
});

test("removing asks a second time in the row before it runs", async () => {
  const { props, findByText, getByRole, queryByText } = setup([{ name: "origin", url: "https://x/a.git" }]);
  await findByText("origin");

  fireEvent.click(getByRole("button", { name: "Remove origin" }));
  assert.equal(props.onRemove.mock.calls.length, 0);
  fireEvent.click(getByRole("button", { name: "Remove origin" }));
  await waitFor(() => assert.equal(props.onRemove.mock.calls.length, 1));
  await findByText("This repository has no remotes.");
  assert.equal(queryByText("origin"), null);
});
