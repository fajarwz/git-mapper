// The title-bar PR door: counts on the button, the popover list, paging and the CLI states.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { PullRequestMenu } from "./PullRequestMenu";
import { openExternal } from "../lib/external";
import type { Feed, PullRequestsView } from "../hooks/usePullRequests";
import type { PullRequest } from "../types";

vi.mock("../lib/external", () => ({ openExternal: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

const feed = (pulls: PullRequest[] = [], over: Partial<Feed> = {}): Feed => ({
  pulls,
  cursor: null,
  total: null,
  loaded: true,
  loading: false,
  loadingMore: false,
  moreError: null,
  ...over,
});

const view = (over: Partial<PullRequestsView> = {}): PullRequestsView => ({
  status: "ok",
  provider: "github",
  error: null,
  loading: false,
  open: feed(),
  all: feed([], { loaded: false }),
  byBranch: new Map(),
  reload: vi.fn(),
  loadMore: vi.fn(),
  showAll: vi.fn(),
  ...over,
});

const openMenu = (container: HTMLElement) =>
  fireEvent.click(container.querySelector("[data-pr-menu]") as HTMLElement);

const many = (count: number) => Array.from({ length: count }, (_, index) => pull({ number: index + 1, title: `PR ${index + 1}` }));

test("counts the open requests on the button and lists only those until All is chosen", () => {
  const live = [pull({ number: 1, title: "First" }), pull({ number: 2, title: "Draft one", state: "draft" })];
  const showAll = vi.fn();
  const { container } = render(
    <PullRequestMenu
      pulls={view({
        open: feed(live),
        all: feed([...live, pull({ number: 3, title: "Shipped", state: "merged" })]),
        showAll,
      })}
    />,
  );
  assert.equal(container.querySelector("[data-pr-menu]")?.textContent, "2", "open + draft count");

  openMenu(container);
  assert.ok(screen.getByText("First"));
  assert.ok(screen.getByText("Draft one"));
  assert.equal(screen.queryByText("Shipped"), null, "merged PRs wait behind All");

  fireEvent.click(screen.getByRole("button", { name: /^All/ }));
  assert.equal(showAll.mock.calls.length, 1, "opening All asks for its first page");
  assert.ok(screen.getByText("Shipped"));
});

test("the count is the provider's total, not what has loaded so far", () => {
  const { container } = render(
    <PullRequestMenu pulls={view({ open: feed(many(30), { total: 199, cursor: "c1" }), all: feed([], { loaded: true, total: 7213 }) })} />,
  );
  assert.equal(container.querySelector("[data-pr-menu]")?.textContent, "9+");
  assert.equal(container.querySelector("[data-pr-menu]")?.getAttribute("title"), "199 open pull requests");
  openMenu(container);
  assert.match(within(screen.getByRole("group", { name: /^Filter/ })).getByRole("button", { name: /^Open/ }).textContent ?? "", /199/);
  assert.match(within(screen.getByRole("group", { name: /^Filter/ })).getByRole("button", { name: /^All/ }).textContent ?? "", /7\.2k/, "thousands are shortened");
});

test("without a total, a full page reads as 'at least' with a plus", () => {
  const { container } = render(
    <PullRequestMenu pulls={view({ provider: "gitlab", open: feed(many(30), { cursor: "2" }) })} />,
  );
  openMenu(container);
  assert.match(within(screen.getByRole("group", { name: /^Filter/ })).getByRole("button", { name: /^Open/ }).textContent ?? "", /30\+/);
});

test("a row opens its PR in the browser", () => {
  const { container } = render(<PullRequestMenu pulls={view({ open: feed([pull({})]) })} />);
  openMenu(container);
  fireEvent.click(document.querySelector("[data-pr-row]") as HTMLElement);
  assert.equal(vi.mocked(openExternal).mock.calls.at(-1)?.[0], "https://github.com/o/r/pull/1");
});

test("explains a missing or signed-out CLI in place and offers a refresh", () => {
  const reload = vi.fn();
  const { container, rerender } = render(<PullRequestMenu pulls={view({ status: "cli-missing", reload })} />);
  openMenu(container);
  assert.ok(screen.getByText(/not installed/));
  fireEvent.click(screen.getByLabelText("Refresh"));
  assert.equal(reload.mock.calls.length, 1);

  rerender(<PullRequestMenu pulls={view({ status: "cli-unauthenticated", reload })} />);
  assert.ok(screen.getByText(/not signed in/));
});

test("a GitLab repo says merge requests, writes !n and points at glab", () => {
  const gitlab = pull({ provider: "gitlab", number: 7, title: "Add runner", url: "https://gitlab.com/g/p/-/merge_requests/7" });
  const { container, rerender } = render(
    <PullRequestMenu pulls={view({ provider: "gitlab", open: feed([gitlab]) })} />,
  );
  assert.equal(container.querySelector("[data-pr-menu]")?.getAttribute("aria-label"), "Merge requests");
  openMenu(container);
  assert.ok(screen.getByText("!7"));
  assert.equal(document.querySelector("[data-pr-row]")?.getAttribute("title"), "Open on GitLab");

  rerender(<PullRequestMenu pulls={view({ provider: "gitlab", status: "cli-missing" })} />);
  assert.ok(screen.getByText(/GitLab CLI, which is not installed/));
  rerender(<PullRequestMenu pulls={view({ provider: "gitlab", status: "cli-unauthenticated" })} />);
  assert.ok(screen.getByText(/glab auth login/));
});

test("with no known provider, a missing CLI names both options", () => {
  const { container } = render(<PullRequestMenu pulls={view({ provider: null, status: "cli-missing" })} />);
  openMenu(container);
  assert.ok(screen.getByText(/neither is installed/));
});

test("a repo with no GitHub or GitLab remote shows no button at all", () => {
  const { container } = render(<PullRequestMenu pulls={view({ status: "unsupported-remote" })} />);
  assert.equal(container.querySelector("[data-pr-menu]"), null);
});

test("Escape closes the popover", () => {
  const { container } = render(<PullRequestMenu pulls={view({ open: feed([pull({})]) })} />);
  openMenu(container);
  assert.ok(document.querySelector("[data-pr-panel]"));
  fireEvent.keyDown(window, { key: "Escape" });
  assert.equal(document.querySelector("[data-pr-panel]"), null);
});

test("a row shows its checks and review as labelled chips, and none when it has neither", () => {
  const pulls = [
    pull({ number: 1, title: "Green", checks: "passing", review: "approved" }),
    pull({ number: 2, title: "Red", checks: "failing", review: "changes" }),
    pull({ number: 3, title: "Running", checks: "pending", review: "required" }),
    pull({ number: 4, title: "Bare", checks: "none", review: null }),
  ];
  const { container } = render(<PullRequestMenu pulls={view({ open: feed(pulls) })} />);
  openMenu(container);
  const rows = [...document.querySelectorAll("[data-pr-row]")];
  const text = (index: number) => rows[index].textContent ?? "";
  assert.match(text(0), /Checks passing/);
  assert.match(text(0), /Approved/);
  assert.match(text(1), /Checks failing/);
  assert.match(text(1), /Changes requested/);
  assert.match(text(2), /Checks running/);
  assert.match(text(2), /Review required/);
  assert.doesNotMatch(text(3), /Checks|Approved|Review/);
});

test("a state is a labelled glyph, not just a colour", () => {
  const pulls = [
    pull({ number: 1, state: "open" }),
    pull({ number: 2, state: "draft" }),
    pull({ number: 3, state: "merged" }),
    pull({ number: 4, state: "closed" }),
  ];
  const { container } = render(<PullRequestMenu pulls={view({ all: feed(pulls) })} />);
  openMenu(container);
  fireEvent.click(screen.getByRole("button", { name: /^All/ }));
  for (const label of ["Open", "Draft", "Merged", "Closed"]) {
    assert.ok(screen.getByRole("img", { name: label }), `${label} has its own glyph tile`);
  }
});

test("an empty Open tab points at the finished ones under All", () => {
  const { container } = render(<PullRequestMenu pulls={view({ open: feed([]) })} />);
  openMenu(container);
  assert.ok(screen.getByText("No open pull requests"));
  assert.ok(screen.getByText(/under All/));
});

test("the first read shows skeleton rows instead of an empty list", () => {
  const { container } = render(
    <PullRequestMenu pulls={view({ status: null, loading: true, open: feed([], { loaded: false, loading: true }) })} />,
  );
  openMenu(container);
  assert.ok(screen.getByRole("status"));
  assert.equal(document.querySelectorAll("[data-pr-row]").length, 0);
});

test("without an observer, a waiting page is one click away", () => {
  const loadMore = vi.fn();
  const { container } = render(
    <PullRequestMenu pulls={view({ open: feed(many(30), { cursor: "c1", total: 199 }), loadMore })} />,
  );
  openMenu(container);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  assert.deepEqual(loadMore.mock.calls, [["open"]]);
});

test("with an observer, reaching the end of the list loads the next page by itself", () => {
  let reached: ((hits: Array<{ isIntersecting: boolean }>) => void) | null = null;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (hits: Array<{ isIntersecting: boolean }>) => void) {
        reached = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const loadMore = vi.fn();
  const { container } = render(
    <PullRequestMenu pulls={view({ open: feed(many(30), { cursor: "c1", total: 199 }), loadMore })} />,
  );
  openMenu(container);
  assert.equal(screen.queryByRole("button", { name: "Load more" }), null, "no button where scrolling works");
  assert.ok(reached, "the sentinel is watched once the panel is up");
  act(() => reached?.([{ isIntersecting: false }]));
  assert.equal(loadMore.mock.calls.length, 0, "an off-screen sentinel loads nothing");
  act(() => reached?.([{ isIntersecting: true }]));
  assert.deepEqual(loadMore.mock.calls, [["open"]]);
});

test("a page in flight shows a skeleton row and offers no second request", () => {
  const { container } = render(
    <PullRequestMenu pulls={view({ open: feed(many(30), { cursor: "c1", loadingMore: true }) })} />,
  );
  openMenu(container);
  assert.equal(document.querySelectorAll("[data-pr-row]").length, 30, "rows already loaded stay");
  assert.ok(screen.getByRole("status"));
  assert.equal(screen.queryByRole("button", { name: "Load more" }), null);
});

test("a failed page keeps the rows and offers a retry", () => {
  const loadMore = vi.fn();
  const { container } = render(
    <PullRequestMenu pulls={view({ open: feed(many(30), { cursor: "c1", moreError: "HTTP 502" }), loadMore })} />,
  );
  openMenu(container);
  assert.equal(document.querySelectorAll("[data-pr-row]").length, 30);
  assert.ok(screen.getByText(/Could not load more pull requests: HTTP 502/));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  assert.deepEqual(loadMore.mock.calls, [["open"]]);
});

test("the end of a multi-page list says so; a one-page list stays quiet", () => {
  const { container, rerender } = render(<PullRequestMenu pulls={view({ open: feed(many(31)) })} />);
  openMenu(container);
  assert.ok(screen.getByText("That's all of them."));

  rerender(<PullRequestMenu pulls={view({ open: feed(many(5)) })} />);
  assert.equal(screen.queryByText("That's all of them."), null);
});
