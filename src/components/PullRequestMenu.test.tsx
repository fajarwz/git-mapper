// The title-bar PR door: counts on the button, the popover list, paging and the CLI states.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { PullRequestMenu } from "./PullRequestMenu";
import { openExternal } from "../lib/external";
import type { Feed, PullRequestsView } from "../hooks/usePullRequests";
import type { PullRequest, PullScope } from "../types";

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
  mergeCommit: null,
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

type Feeds = Record<PullScope, Feed>;
const feeds = (over: Partial<Feeds> = {}): Feeds => ({
  open: feed(),
  merged: feed([], { loaded: false }),
  all: feed([], { loaded: false }),
  ...over,
});

/** A view over plain lists; `open`/`merged`/`all` fill those lists, and `found` + `query` make it a search. */
const view = (
  over: Partial<PullRequestsView> & { open?: Feed; merged?: Feed; all?: Feed; found?: Partial<Feeds> } = {},
): PullRequestsView => {
  const { open, merged, all, found, ...rest } = over;
  const plain = feeds({
    ...(open ? { open } : {}),
    ...(merged ? { merged } : {}),
    ...(all ? { all } : {}),
  });
  return {
    status: "ok",
    provider: "github",
    error: null,
    loading: false,
    query: "",
    feeds: plain,
    view: found ? feeds(found) : plain,
    byBranch: new Map(),
    reload: vi.fn(),
    loadMore: vi.fn(),
    show: vi.fn(),
    setQuery: vi.fn(),
    ...rest,
  };
};

const openMenu = (container: HTMLElement) =>
  fireEvent.click(container.querySelector("[data-pr-menu]") as HTMLElement);

const many = (count: number) => Array.from({ length: count }, (_, index) => pull({ number: index + 1, title: `PR ${index + 1}` }));

test("counts the open requests on the button and lists only those until All is chosen", () => {
  const live = [pull({ number: 1, title: "First" }), pull({ number: 2, title: "Draft one", state: "draft" })];
  const show = vi.fn();
  const { container } = render(
    <PullRequestMenu
      pulls={view({
        open: feed(live),
        all: feed([...live, pull({ number: 3, title: "Shipped", state: "merged" })]),
        show,
      })}
    />,
  );
  assert.equal(container.querySelector("[data-pr-menu]")?.textContent, "2", "open + draft count");

  openMenu(container);
  assert.ok(screen.getByText("First"));
  assert.ok(screen.getByText("Draft one"));
  assert.equal(screen.queryByText("Shipped"), null, "merged PRs wait behind All");

  fireEvent.click(screen.getByRole("button", { name: /^All/ }));
  assert.ok(show.mock.calls.some((call) => call[0] === "all"), "choosing All asks for its first page");
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

const tab = (name: RegExp) => within(screen.getByRole("group", { name: /^Filter/ })).getByRole("button", { name });

test("a Merged tab lists the merged requests and reads them the first time it is chosen", () => {
  const show = vi.fn();
  const merged = feed([pull({ number: 9, title: "Shipped", state: "merged" })], { total: 322 });
  const { container } = render(<PullRequestMenu pulls={view({ open: feed([pull({})]), merged, show })} />);
  openMenu(container);
  assert.equal(screen.queryByText("Shipped"), null, "Open does not list merged ones");
  fireEvent.click(tab(/^Merged/));
  assert.ok(screen.getByText("Shipped"));
  assert.match(tab(/^Merged/).textContent ?? "", /322/);
  assert.ok(show.mock.calls.some((call) => call[0] === "merged"));
});

test("an empty Merged tab says nothing has been merged", () => {
  const { container } = render(<PullRequestMenu pulls={view({ merged: feed([]) })} />);
  openMenu(container);
  fireEvent.click(tab(/^Merged/));
  assert.ok(screen.getByText("No merged pull requests"));
});

test("a selected tab reads itself on a repo whose list was never loaded", () => {
  const first = vi.fn();
  const { container, rerender } = render(<PullRequestMenu pulls={view({ show: first })} />);
  openMenu(container);
  fireEvent.click(tab(/^All/));
  assert.ok(first.mock.calls.some((call) => call[0] === "all"));

  // Another repo: a new `show`, lists nobody has asked for, and the tab still on All.
  const second = vi.fn();
  rerender(<PullRequestMenu pulls={view({ show: second })} />);
  assert.ok(second.mock.calls.some((call) => call[0] === "all"), "no click needed: the selected tab asks for its list");
  assert.ok(screen.getByRole("status"), "and shows the skeleton only while that read is out");
});

test("a selected tab does not ask for a list while the CLI cannot answer", () => {
  const show = vi.fn();
  const { container } = render(<PullRequestMenu pulls={view({ status: "cli-missing", show })} />);
  openMenu(container);
  assert.equal(show.mock.calls.length, 0);
});

test("typing searches after a pause, one request per word rather than per keystroke", () => {
  vi.useFakeTimers();
  try {
    const setQuery = vi.fn();
    const { container } = render(<PullRequestMenu pulls={view({ setQuery })} />);
    openMenu(container);
    const box = screen.getByLabelText("Search pull requests");
    fireEvent.change(box, { target: { value: "web" } });
    fireEvent.change(box, { target: { value: "webview" } });
    act(() => void vi.advanceTimersByTime(200));
    assert.equal(setQuery.mock.calls.length, 0, "still typing");
    act(() => void vi.advanceTimersByTime(200));
    assert.deepEqual(setQuery.mock.calls, [["webview"]]);
  } finally {
    vi.useRealTimers();
  }
});

test("clearing the box goes back to the plain list at once", () => {
  vi.useFakeTimers();
  try {
    const setQuery = vi.fn();
    const { container } = render(
      <PullRequestMenu pulls={view({ query: "webview", found: { open: feed([pull({ title: "Webview fix" })]) }, setQuery })} />,
    );
    openMenu(container);
    fireEvent.change(screen.getByLabelText("Search pull requests"), { target: { value: "webview" } });
    fireEvent.click(screen.getByLabelText("Clear search"));
    act(() => void vi.advanceTimersByTime(0));
    assert.deepEqual(setQuery.mock.calls.at(-1), [""]);
  } finally {
    vi.useRealTimers();
  }
});

test("Escape clears the search text first, and only an empty box lets it close the popover", () => {
  const { container } = render(<PullRequestMenu pulls={view()} />);
  openMenu(container);
  const box = screen.getByLabelText("Search pull requests") as HTMLInputElement;
  fireEvent.change(box, { target: { value: "web" } });
  fireEvent.keyDown(box, { key: "Escape" });
  assert.equal(box.value, "");
  assert.ok(document.querySelector("[data-pr-panel]"), "the first Escape only cleared the box");
  fireEvent.keyDown(box, { key: "Escape" });
  assert.equal(document.querySelector("[data-pr-panel]"), null);
});

test("a search shows its own results, counts and an empty state that names the text", () => {
  const { container, rerender } = render(
    <PullRequestMenu
      pulls={view({
        open: feed([pull({ number: 1, title: "Plain" })], { total: 199 }),
        query: "webview",
        found: { open: feed([pull({ number: 7, title: "Webview fix" })], { total: 12 }), all: feed([], { total: 40 }) },
      })}
    />,
  );
  openMenu(container);
  assert.ok(screen.getByText("Webview fix"));
  assert.equal(screen.queryByText("Plain"), null, "the plain list is not mixed into a search");
  assert.match(tab(/^Open/).textContent ?? "", /12/, "the tab counts are the search's");
  assert.match(tab(/^All/).textContent ?? "", /40/);
  assert.equal(container.querySelector("[data-pr-menu]")?.textContent, "9+", "the button still counts the open list");

  rerender(<PullRequestMenu pulls={view({ query: "zzz", found: { open: feed([]) } })} />);
  assert.ok(screen.getByText(/match .zzz./));
  assert.ok(screen.getByText(/Try a word from the title/));
});

test("there is no search box until the CLI has answered", () => {
  const { container } = render(<PullRequestMenu pulls={view({ status: "cli-missing" })} />);
  openMenu(container);
  assert.equal(screen.queryByLabelText("Search pull requests"), null);
});
