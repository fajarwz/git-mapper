// @vitest-environment jsdom
// Context menu behaviour: which entries show, what copy writes, how it closes.
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { ContextMenu, type ContextMenuTarget } from "./ContextMenu";
import type { Commit } from "../types";

function commit(fields: Partial<Commit>): Commit {
  return {
    hash: "aaaa1111",
    subject: "feat: one",
    author: "Fajar",
    authorEmail: "fajar@example.com",
    date: "2026-10-25T10:00:00+07:00",
    lane: 0,
    branchColor: 0,
    parents: [],
    refs: [],
    ...fields,
  };
}

function target(fields: Partial<ContextMenuTarget>): ContextMenuTarget {
  return { x: 20, y: 20, commit: commit({}), ...fields };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // @ts-expect-error jsdom's navigator has no clipboard by default; drop the stub.
  delete navigator.clipboard;
});

test("a local branch that is not checked out offers the checkout", () => {
  const onCheckout = vi.fn();
  const onClose = vi.fn();
  const { getByRole } = render(
    <ContextMenu
      target={target({ ref: { type: "branch", name: "feature" } })}
      onCheckout={onCheckout}
      onClose={onClose}
    />,
  );

  const item = getByRole("menuitem", { name: "Check out feature" });
  fireEvent.click(item);
  assert.equal(onCheckout.mock.calls[0][0], "feature");
  assert.ok(onClose.mock.calls.length > 0, "the menu closes once the action fires");
});

test("the checked-out branch offers no checkout entry", () => {
  const { queryByRole, getByRole } = render(
    <ContextMenu
      target={target({ ref: { type: "branch", name: "main", isCurrent: true } })}
      onCheckout={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  assert.equal(queryByRole("menuitem", { name: /check out/i }), null);
  assert.ok(getByRole("menuitem", { name: "Copy branch name" }));
});

test("copy entries write the commit's fields to the clipboard and confirm", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  (navigator as unknown as { clipboard: unknown }).clipboard = { writeText };
  const onClose = vi.fn();
  const { getByRole, getByText } = render(
    <ContextMenu
      target={target({ ref: { type: "tag", name: "v2.0.1" } })}
      onCheckout={vi.fn()}
      onClose={onClose}
    />,
  );

  fireEvent.click(getByRole("menuitem", { name: "Copy commit hash" }));
  assert.deepEqual(writeText.mock.calls[0], ["aaaa1111"]);
  assert.ok(getByText("Copied!"), "the menu confirms the copy before closing");

  fireEvent.click(getByRole("menuitem", { name: /copy tag name/i }));
  assert.deepEqual(writeText.mock.calls[1], ["v2.0.1"]);
});

test("a right-click anywhere else than the menu closes it", async () => {
  const onClose = vi.fn();
  const { getByRole } = render(
    <ContextMenu target={target({})} onCheckout={vi.fn()} onClose={onClose} />,
  );
  assert.ok(getByRole("menu"));

  fireEvent.pointerDown(document.body);
  await new Promise((resolve) => window.setTimeout(resolve, 5));
  assert.ok(onClose.mock.calls.length > 0, "a pointer down outside dismisses the menu");
});
