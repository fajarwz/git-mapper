// Ref pills: filled when checked out, outline with the lane colour otherwise.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, render, fireEvent, within } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { RefPill } from "./RefPill";
import type { CommitRef } from "../types";

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
