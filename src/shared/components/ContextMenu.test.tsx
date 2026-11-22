// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { ContextMenu, type ContextMenuTarget } from "./ContextMenu";
import type { Commit } from "../../types";

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
      onStashAction={vi.fn()}
      head={HEAD}
      onClose={onClose}
    />,
  );

  const item = getByRole("menuitem", { name: "Check out feature" });
  fireEvent.click(item);
  assert.equal(onCheckout.mock.calls[0][0], "feature");
  assert.ok(onClose.mock.calls.length > 0, "the menu closes once the action fires");
});

test("a non-current local branch offers the merge into the checked-out one", () => {
  const onMerge = vi.fn();
  const { getByRole } = render(
    <ContextMenu
      target={target({ ref: { type: "branch", name: "feature" } })}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      onStashAction={vi.fn()}
      head={HEAD}
      currentBranch="main"
      onMerge={onMerge}
      onClose={vi.fn()}
    />,
  );

  const item = getByRole("menuitem", { name: "Merge into main" });
  fireEvent.click(item);
  assert.equal(onMerge.mock.calls[0][0], "feature");
});

test("the merge entry only exists for mergeable pills", () => {
  // No handler passed (detached HEAD, for instance): the checked-out pill offers nothing.
  const { queryByRole, getByText } = render(
    <ContextMenu
      target={target({ ref: { type: "branch", name: "main", isCurrent: true } })}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      onStashAction={vi.fn()}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );
  assert.equal(queryByRole("menuitem", { name: /merge/i }), null);
  assert.ok(getByText("Copy branch name"), "the copy entries still speak for the pill");
});

test("a branch pill offers a pull request, a remote pill passes the bare branch name", () => {
  const onCreatePullRequest = vi.fn();
  for (const [ref, expected] of [
    [{ type: "branch", name: "main", isCurrent: true }, "main"],
    [{ type: "remote", name: "origin/feat/x" }, "feat/x"],
  ] as const) {
    const { getByRole } = render(
      <ContextMenu
        target={target({ ref })}
        onCheckout={vi.fn()}
        onCheckoutCommit={vi.fn()}
        onStashAction={vi.fn()}
        head={HEAD}
        onCreatePullRequest={onCreatePullRequest}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(getByRole("menuitem", { name: "Create pull request…" }));
    assert.equal(onCreatePullRequest.mock.calls.at(-1)?.[0], expected);
    cleanup();
  }
});

test("a tag or plain commit offers no pull request", () => {
  const { queryByRole } = render(
    <ContextMenu
      target={target({ ref: { type: "tag", name: "v1" } })}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      onStashAction={vi.fn()}
      head={HEAD}
      onCreatePullRequest={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  assert.equal(queryByRole("menuitem", { name: /pull request/i }), null);
});

test("the checked-out branch offers no checkout entry", () => {
  const { queryByRole, getByRole } = render(
    <ContextMenu
      target={target({ ref: { type: "branch", name: "main", isCurrent: true } })}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      onStashAction={vi.fn()}
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
      onStashAction={vi.fn()}
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

test("a stash row offers its actions and apply runs without a confirm", () => {
  const onStashAction = vi.fn();
  const stashCommit = commit({ hash: "cccc3333", subject: "On feature: halfway", stashIndex: 1 });
  const { getByRole } = render(
    <ContextMenu
      target={target({ commit: stashCommit, ref: { type: "stash", name: "stash@{1}" } })}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      onStashAction={onStashAction}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );

  const apply = getByRole("menuitem", { name: "Apply stash" });
  fireEvent.click(apply);
  assert.deepEqual(onStashAction.mock.calls[0], [1, "apply"]);

  assert.ok(getByRole("menuitem", { name: "Pop stash…" }), "pop shows the confirm ellipsis");
  assert.ok(getByRole("menuitem", { name: "Drop stash…" }));
});

test("a history row offers no stash actions", () => {
  const { queryByRole } = render(
    <ContextMenu
      target={target({})}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      onStashAction={vi.fn()}
      onStashAction={vi.fn()}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );
  assert.equal(queryByRole("menuitem", { name: "Apply stash" }), null);
  assert.equal(queryByRole("menuitem", { name: /stash/ }), null);
});

test("the HEAD row offers no commit checkout", () => {
  const { queryByRole } = render(
    <ContextMenu
      target={target({})}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      onStashAction={vi.fn()}
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
      onStashAction={vi.fn()}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );
  assert.equal(queryByRole("menuitem", { name: /check out commit/i }), null);
});

test("the uncommitted row offers no commit-hash copy — the pseudo hash is not a commit", () => {
  const { queryByRole } = render(
    <ContextMenu
      target={target({ commit: commit({ hash: "wip", subject: "Uncommitted changes" }) })}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      onStashAction={vi.fn()}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );
  assert.equal(queryByRole("menuitem", { name: /copy commit hash/i }), null);
});

test("a stash row offers no commit checkout", () => {
  const { queryByRole } = render(
    <ContextMenu
      target={target({ commit: commit({ hash: "cccc3333", subject: "On feature: halfway", stashIndex: 0 }) })}
      onCheckout={vi.fn()}
      onCheckoutCommit={vi.fn()}
      onStashAction={vi.fn()}
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
      onStashAction={vi.fn()}
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
      onStashAction={vi.fn()}
      head={HEAD}
      onClose={onClose}
    />,
  );
  assert.ok(getByRole("menu"));

  fireEvent.pointerDown(document.body);
  await new Promise((resolve) => window.setTimeout(resolve, 5));
  assert.ok(onClose.mock.calls.length > 0, "a pointer down outside dismisses the menu");
});

test("a remote branch offers a checkout that hands over its full ref", () => {
  const onCheckoutRemote = vi.fn();
  const { getByRole, queryByRole } = render(
    <ContextMenu
      target={target({ ref: { type: "remote", name: "origin/feature/x" } })}
      onCheckout={vi.fn()}
      onCheckoutRemote={onCheckoutRemote}
      onCheckoutCommit={vi.fn()}
      onStashAction={vi.fn()}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );

  fireEvent.click(getByRole("menuitem", { name: "Check out origin/feature/x…" }));
  assert.equal(onCheckoutRemote.mock.calls[0][0], "origin/feature/x");
  assert.equal(queryByRole("menuitem", { name: /Merge into/ }), null);
});

test("the remote's symbolic HEAD offers no checkout", () => {
  const { queryByRole } = render(
    <ContextMenu
      target={target({ ref: { type: "remote", name: "origin/HEAD" } })}
      onCheckout={vi.fn()}
      onCheckoutRemote={vi.fn()}
      onCheckoutCommit={vi.fn()}
      onStashAction={vi.fn()}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );
  assert.equal(queryByRole("menuitem", { name: /Check out origin\/HEAD/ }), null);
});

test("a history row offers Create branch here with its hash, a stash row does not", () => {
  const onCreateBranch = vi.fn();
  const first = render(
    <ContextMenu
      target={target({})}
      onCheckout={vi.fn()}
      onCreateBranch={onCreateBranch}
      onCheckoutCommit={vi.fn()}
      onStashAction={vi.fn()}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(first.getByRole("menuitem", { name: "Create branch here…" }));
  assert.equal(onCreateBranch.mock.calls[0][0], "aaaa1111");
  cleanup();

  const stash = render(
    <ContextMenu
      target={target({ commit: commit({ stashIndex: 0 }) })}
      onCheckout={vi.fn()}
      onCreateBranch={onCreateBranch}
      onCheckoutCommit={vi.fn()}
      onStashAction={vi.fn()}
      head={HEAD}
      onClose={vi.fn()}
    />,
  );
  assert.equal(stash.queryByRole("menuitem", { name: "Create branch here…" }), null);
});

test("local and remote branch pills offer their own delete, the checked-out branch none", () => {
  const onDeleteBranch = vi.fn();
  const render_ = (ref: ContextMenuTarget["ref"]) =>
    render(
      <ContextMenu
        target={target({ ref })}
        onCheckout={vi.fn()}
        onCheckoutRemote={vi.fn()}
        onDeleteBranch={onDeleteBranch}
        onCheckoutCommit={vi.fn()}
        onStashAction={vi.fn()}
        head={HEAD}
        onClose={vi.fn()}
      />,
    );

  const local = render_({ type: "branch", name: "feature" });
  fireEvent.click(local.getByRole("menuitem", { name: "Delete branch feature…" }));
  assert.deepEqual(onDeleteBranch.mock.calls[0], ["feature", false]);
  cleanup();

  const remote = render_({ type: "remote", name: "origin/feature" });
  fireEvent.click(remote.getByRole("menuitem", { name: "Delete remote branch origin/feature…" }));
  assert.deepEqual(onDeleteBranch.mock.calls[1], ["origin/feature", true]);
  cleanup();

  const current = render_({ type: "branch", name: "main", isCurrent: true });
  assert.equal(current.queryByRole("menuitem", { name: /Delete branch/ }), null);
});

test("a commit offers Create tag here, and a tag pill offers its own delete", () => {
  const onCreateTag = vi.fn();
  const onDeleteTag = vi.fn();
  const onPushTag = vi.fn();
  const render_ = (fields: Partial<ContextMenuTarget>) =>
    render(
      <ContextMenu
        target={target(fields)}
        onCheckout={vi.fn()}
        onCreateTag={onCreateTag}
        onDeleteTag={onDeleteTag}
        onPushTag={onPushTag}
        onCheckoutCommit={vi.fn()}
        onStashAction={vi.fn()}
        head={HEAD}
        onClose={vi.fn()}
      />,
    );

  const plain = render_({});
  fireEvent.click(plain.getByRole("menuitem", { name: "Create tag here…" }));
  assert.equal(onCreateTag.mock.calls.length, 1);
  assert.equal(plain.queryByRole("menuitem", { name: /Delete tag/ }), null);
  cleanup();

  const tag = render_({ ref: { type: "tag", name: "v1" } });
  fireEvent.click(tag.getByRole("menuitem", { name: "Delete tag v1…" }));
  assert.deepEqual(onDeleteTag.mock.calls[0], ["v1", false]);
  cleanup();

  const remoteTag = render_({ ref: { type: "tag", name: "v1" } });
  fireEvent.click(remoteTag.getByRole("menuitem", { name: "Delete remote tag v1…" }));
  assert.deepEqual(onDeleteTag.mock.calls[1], ["v1", true]);
  fireEvent.click(remoteTag.getByRole("menuitem", { name: "Push tag v1" }));
  assert.deepEqual(onPushTag.mock.calls[0], ["v1"]);
  cleanup();

  const stash = render_({ commit: commit({ stashIndex: 0 }) });
  assert.equal(stash.queryByRole("menuitem", { name: "Create tag here…" }), null);
});
