// The title-bar PR door: open count on the button, popover list, and the gh states.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { PullRequestMenu } from "./PullRequestMenu";
import { openExternal } from "../lib/external";
import type { PullRequestsView } from "../hooks/usePullRequests";
import type { PullRequest } from "../types";

vi.mock("../lib/external", () => ({ openExternal: vi.fn() }));

afterEach(() => {
  cleanup();
});

const pull = (over: Partial<PullRequest>): PullRequest => ({
  provider: "github",
  number: 1,
  title: "First",
  state: "open",
  author: "a",
  headBranch: "feat/x",
  baseBranch: "main",
  url: "https://github.com/o/r/pull/1",
  updatedAt: "2026-11-16T01:56:09Z",
  checks: "passing",
  review: null,
  fromFork: false,
  ...over,
});

const view = (over: Partial<PullRequestsView>): PullRequestsView => ({
  status: "ok",
  provider: "github",
  pulls: [],
  loading: false,
  error: null,
  byBranch: new Map(),
  reload: vi.fn(),
  ...over,
});

test("counts live PRs on the button and lists only those until All is chosen", () => {
  const pulls = [
    pull({ number: 1, title: "First" }),
    pull({ number: 2, title: "Draft one", state: "draft" }),
    pull({ number: 3, title: "Shipped", state: "merged" }),
  ];
  const { container } = render(<PullRequestMenu pulls={view({ pulls })} />);
  assert.equal(container.querySelector("[data-pr-menu]")?.textContent, "2", "open + draft count");

  fireEvent.click(container.querySelector("[data-pr-menu]") as HTMLElement);
  assert.ok(screen.getByText("First"));
  assert.ok(screen.getByText("Draft one"));
  assert.equal(screen.queryByText("Shipped"), null, "merged PRs wait behind All");

  fireEvent.click(screen.getByText("All 3"));
  assert.ok(screen.getByText("Shipped"));
});

test("a row opens its PR in the browser", () => {
  const { container } = render(<PullRequestMenu pulls={view({ pulls: [pull({})] })} />);
  fireEvent.click(container.querySelector("[data-pr-menu]") as HTMLElement);
  fireEvent.click(document.querySelector("[data-pr-row]") as HTMLElement);
  assert.equal(vi.mocked(openExternal).mock.calls.at(-1)?.[0], "https://github.com/o/r/pull/1");
});

test("explains a missing or signed-out gh in place and offers a refresh", () => {
  const reload = vi.fn();
  const { container, rerender } = render(<PullRequestMenu pulls={view({ status: "cli-missing", reload })} />);
  fireEvent.click(container.querySelector("[data-pr-menu]") as HTMLElement);
  assert.ok(screen.getByText(/not installed/));
  fireEvent.click(screen.getByText("Refresh"));
  assert.equal(reload.mock.calls.length, 1);

  rerender(<PullRequestMenu pulls={view({ status: "cli-unauthenticated", reload })} />);
  assert.ok(screen.getByText(/not signed in/));
});

test("a GitLab repo says merge requests, writes !n and points at glab", () => {
  const gitlab = pull({ provider: "gitlab", number: 7, title: "Add runner", url: "https://gitlab.com/g/p/-/merge_requests/7" });
  const { container, rerender } = render(
    <PullRequestMenu pulls={view({ provider: "gitlab", pulls: [gitlab] })} />,
  );
  assert.equal(container.querySelector("[data-pr-menu]")?.getAttribute("aria-label"), "Merge requests");
  fireEvent.click(container.querySelector("[data-pr-menu]") as HTMLElement);
  assert.ok(screen.getByText("!7"));
  assert.equal(document.querySelector("[data-pr-row]")?.getAttribute("title"), "Open on GitLab");

  rerender(<PullRequestMenu pulls={view({ provider: "gitlab", status: "cli-missing", pulls: [] })} />);
  assert.ok(screen.getByText(/GitLab CLI, which is not installed/));
  rerender(<PullRequestMenu pulls={view({ provider: "gitlab", status: "cli-unauthenticated", pulls: [] })} />);
  assert.ok(screen.getByText(/glab auth login/));
});

test("with no known provider, a missing CLI names both options", () => {
  const { container } = render(<PullRequestMenu pulls={view({ provider: null, status: "cli-missing" })} />);
  fireEvent.click(container.querySelector("[data-pr-menu]") as HTMLElement);
  assert.ok(screen.getByText(/neither is installed/));
});

test("a repo with no GitHub or GitLab remote shows no button at all", () => {
  const { container } = render(<PullRequestMenu pulls={view({ status: "unsupported-remote" })} />);
  assert.equal(container.querySelector("[data-pr-menu]"), null);
});

test("Escape closes the popover", () => {
  const { container } = render(<PullRequestMenu pulls={view({ pulls: [pull({})] })} />);
  fireEvent.click(container.querySelector("[data-pr-menu]") as HTMLElement);
  assert.ok(document.querySelector("[data-pr-panel]"));
  fireEvent.keyDown(window, { key: "Escape" });
  assert.equal(document.querySelector("[data-pr-panel]"), null);
});
