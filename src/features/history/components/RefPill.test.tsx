// Ref pills: filled when checked out, outline with the lane colour otherwise.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, render, fireEvent, within } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { RefPill } from "./RefPill";
import { openExternal } from "../../../shared/lib/external";
import type { CommitRef, PullRequest } from "../../../types";
import { ChecksState, PullRequestProvider, PullRequestState } from "../../../types";

vi.mock("../../../shared/lib/external", () => ({ openExternal: vi.fn() }));

afterEach(() => {
  cleanup();
});

test("RefPill: the checked-out branch fills, everything else outlines", () => {
  const filled = render(
    <RefPill ref={{ type: "branch", name: "main", isCurrent: true, withRemote: "origin" }} color={0} />,
  );
  const span = filled.container.querySelector("span") as HTMLElement;
  assert.ok(span.style.backgroundColor, "the current branch is a filled pill in the lane colour");
  assert.ok(within(filled.container).getByText("origin"), "the remote twin shows inside the pill");

  const outlined = render(
    <RefPill ref={{ type: "branch", name: "side", withRemote: "origin" } as CommitRef} color={0} />,
  );
  const spanSide = outlined.container.querySelector("span") as HTMLElement;
  assert.ok(spanSide.style.borderColor, "an outline pill takes the lane-coloured border");
  assert.ok(spanSide.style.color, "an outline pill tints its text with the lane colour");
});

test("RefPill double-click checks out only local, non-current branches", () => {
  let checkedOut: string | null = null;
  const { container } = render(
    <RefPill
      ref={{ type: "branch", name: "feature" } as CommitRef}
      color={0}
      onCheckout={(name) => {
        checkedOut = name;
      }}
    />,
  );
  fireEvent.doubleClick(within(container).getByText("feature"));
  assert.equal(checkedOut, "feature");

  let lockedCheckout: string | null = null;
  const locked = render(
    <RefPill
      ref={{ type: "branch", name: "main", isCurrent: true } as CommitRef}
      color={0}
      onCheckout={(name) => {
        lockedCheckout = name;
      }}
    />,
  );
  fireEvent.doubleClick(within(locked.container).getByText("main"));
  assert.equal(lockedCheckout, null, "the checked-out branch does not offer a checkout");
});

test("RefPill: a detached HEAD fills like a marker and never offers a checkout", () => {
  let checkedOut: string | null = null;
  const { container } = render(
    <RefPill
      ref={{ type: "head", name: "HEAD", isCurrent: true }}
      color={0}
      onCheckout={(name) => {
        checkedOut = name;
      }}
    />,
  );
  const span = container.querySelector("span") as HTMLElement;
  assert.ok(span.style.backgroundColor, "the detached HEAD is a filled pill");
  assert.ok(within(container).getByText("HEAD (detached)"), "the pill tells the whole story");
  fireEvent.doubleClick(within(container).getByText("HEAD (detached)"));
  assert.equal(checkedOut, null, "a detached HEAD is not a branch you can check out");
});

const PULL: PullRequest = {
  provider: PullRequestProvider.GitHub,
  number: 13,
  title: "Add download",
  state: PullRequestState.Open,
  author: "a",
  headBranch: "feat/x",
  baseBranch: "main",
  url: "https://github.com/o/r/pull/13",
  updatedAt: "2026-11-16T01:56:09Z",
  checks: ChecksState.Passing,
  review: null,
  fromFork: false,
  mergeCommit: null,
};

test("RefPill: a PR chip opens the PR without selecting the row or checking the branch out", () => {
  let rowClicks = 0;
  let checkedOut: string | null = null;
  const { container } = render(
    <button type="button" onClick={() => (rowClicks += 1)}>
      <RefPill
        ref={{ type: "branch", name: "feat/x" }}
        pullRequest={PULL}
        color={0}
        onCheckout={(name) => {
          checkedOut = name;
        }}
      />
    </button>,
  );
  const chip = within(container).getByText("#13");
  fireEvent.click(chip);
  fireEvent.doubleClick(chip);
  assert.equal(vi.mocked(openExternal).mock.calls[0][0], PULL.url);
  assert.equal(rowClicks, 0, "the click stays on the chip");
  assert.equal(checkedOut, null, "a double-click on the chip is not a checkout");
});

test("RefPill: a branch without a PR wears no chip", () => {
  const { container } = render(<RefPill ref={{ type: "branch", name: "feat/x" }} color={0} />);
  assert.equal(container.querySelector("[data-pr-badge]"), null);
});

test("RefPill double-click on a remote branch asks for the remote checkout, never origin/HEAD", () => {
  const remoteCalls: string[] = [];
  const first = render(
    <RefPill
      ref={{ type: "remote", name: "origin/feature/x" } as CommitRef}
      color={0}
      onCheckoutRemote={(name) => remoteCalls.push(name)}
    />,
  );
  fireEvent.doubleClick(first.container.querySelector("span") as HTMLElement);
  assert.deepEqual(remoteCalls, ["origin/feature/x"]);
  cleanup();

  const head = render(
    <RefPill
      ref={{ type: "remote", name: "origin/HEAD" } as CommitRef}
      color={0}
      onCheckoutRemote={(name) => remoteCalls.push(name)}
    />,
  );
  fireEvent.doubleClick(head.container.querySelector("span") as HTMLElement);
  assert.equal(remoteCalls.length, 1, "origin/HEAD is not a branch to check out");
});
