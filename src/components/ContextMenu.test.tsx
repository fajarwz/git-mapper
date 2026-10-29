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

// Full sha at HEAD: a history row's short hash is a prefix of it, the synthetic rows never are.
const HEAD = "aaaa1111" + "f".repeat(32);

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
      onCheckoutCommit={vi.fn()}
      head={HEAD}
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
      onCheckoutCommit={vi.fn()}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );
  assert.equal(queryByRole("menuitem", { name: /check out/i }), null);
  assert.ok(getByRole("menuitem", { name: "Copy branch name" }));
});

test("a detached HEAD offers no checkout; copying names it a ref", () => {
  const { getByRole, queryByRole } = render(
    <ContextMenu
      target={target({ ref: { type: "head", name: "HEAD", isCurrent: true } })}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );
  assert.equal(queryByRole("menuitem", { name: /check out/i }), null);
  assert.ok(getByRole("menuitem", { name: "Copy ref name" }));
});

test("a history row offers the commit checkout and hands over the hash", () => {
  const onCheckoutCommit = vi.fn();
  const { getByRole } = render(
    <ContextMenu
      target={target({})}
      onCheckout={vi.fn()}
      onCheckoutCommit={onCheckoutCommit}
      head={"bbbb2222" + "f".repeat(32)}
      onClose={vi.fn()}
    />,
  );

  const item = getByRole("menuitem", { name: "Check out commit aaaa1111" });
  fireEvent.click(item);
  assert.equal(onCheckoutCommit.mock.calls[0][0], "aaaa1111");
});

test("the HEAD row offers no commit checkout", () => {
  const { queryByRole } = render(
    <ContextMenu
      target={target({})}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );
  assert.equal(
    queryByRole("menuitem", { name: /check out commit/i }),
    null,
    "HEAD is already out there",
  );
});

test("the uncommitted row offers no commit checkout", () => {
  const { queryByRole } = render(
    <ContextMenu
      target={target({ commit: commit({ hash: "wip", subject: "Uncommitted changes" }) })}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );
  assert.equal(queryByRole("menuitem", { name: /check out commit/i }), null);
});

test("a stash row offers no commit checkout", () => {
  const { queryByRole } = render(
    <ContextMenu
      target={target({ commit: commit({ hash: "cccc3333", subject: "On feature: halfway", stashIndex: 0 }) })}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );
  assert.equal(queryByRole("menuitem", { name: /check out commit/i }), null);
});

test("copy entries write the commit's fields to the clipboard and confirm", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  (navigator as unknown as { clipboard: unknown }).clipboard = { writeText };
  const onClose = vi.fn();
  const { getByRole, getByText } = render(
    <ContextMenu
      target={target({ ref: { type: "tag", name: "v2.0.1" } })}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      head={HEAD}
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
    <ContextMenu
      target={target({})}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      head={HEAD}
      onClose={onClose}
    />,
  );
  assert.ok(getByRole("menu"));

  fireEvent.pointerDown(document.body);
  await new Promise((resolve) => window.setTimeout(resolve, 5));
  assert.ok(onClose.mock.calls.length > 0, "a pointer down outside dismisses the menu");
});
