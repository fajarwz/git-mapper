// Per-repo PR reads: Open on arrival, other scopes on demand, a page at a time, search, no pointless retries.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, test, vi } from "vitest";

import { usePullRequests } from "./usePullRequests";
import { loadPullRequests } from "../data/gitLoader";
import type { PullRequest, PullRequestsStatus, Repository } from "../types";

vi.mock("../data/gitLoader", () => ({ loadPullRequests: vi.fn() }));

const pull = (number: number, over: Partial<PullRequest> = {}): PullRequest => ({
  provider: "github",
  number,
  title: `PR ${number}`,
  state: "open",
  author: "a",
  headBranch: `feat/${number}`,
  baseBranch: "main",
  url: "u",
  updatedAt: "2026-01-01T00:00:00Z",
  checks: "none",
  review: null,
  fromFork: false,
  mergeCommit: null,
  ...over,
});

const page = (
  pulls: PullRequest[],
  over: { status?: PullRequestsStatus; nextCursor?: string | null; total?: number | null } = {},
) => ({
  status: over.status ?? "ok",
  provider: "github" as const,
  pullRequests: pulls,
  nextCursor: over.nextCursor ?? null,
  total: over.total ?? null,
});

const repo = (over: Partial<Repository> = {}) => ({ path: "/r", refsDigest: "d1", ...over }) as Repository;
const mount = (initial: Repository = repo()) =>
  renderHook(({ r }) => usePullRequests(r), { initialProps: { r: initial } });
const reads = () => vi.mocked(loadPullRequests).mock.calls;
/** [scope, cursor, query] of each read, to say what was asked without the repeated dir/provider. */
const asked = () => reads().map((call) => [call[1], call[2], call[4]]);

beforeEach(() => {
  vi.mocked(loadPullRequests).mockReset();
});

test("reads the open list on arrival and exposes the branch lookup", async () => {
  vi.mocked(loadPullRequests).mockResolvedValue(page([pull(1)], { nextCursor: "c1", total: 199 }));
  const { result } = mount();
  await waitFor(() => assert.equal(result.current.status, "ok"));
  assert.deepEqual(reads(), [["/r", "open", null, null, ""]]);
  assert.equal(result.current.feeds.open.total, 199);
  assert.equal(result.current.feeds.open.cursor, "c1");
  assert.equal(result.current.byBranch.get("feat/1")?.number, 1);
  assert.equal(result.current.feeds.merged.loaded, false, "the other scopes wait until they are shown");
  assert.equal(result.current.feeds.all.loaded, false);
});

test("a scope is read the first time it is shown, and reused after", async () => {
  vi.mocked(loadPullRequests).mockImplementation(async (_dir, scope) =>
    scope === "open" ? page([pull(1)]) : page([pull(2, { state: "merged" })], { total: 322 }),
  );
  const { result } = mount();
  await waitFor(() => assert.equal(result.current.feeds.open.loaded, true));
  act(() => result.current.show("merged"));
  await waitFor(() => assert.equal(result.current.feeds.merged.loaded, true));
  assert.equal(result.current.feeds.merged.total, 322);
  act(() => result.current.show("merged"));
  assert.equal(reads().filter((call) => call[1] === "merged").length, 1);
});

test("loadMore asks for the next page of the same provider and appends it without repeats", async () => {
  vi.mocked(loadPullRequests).mockImplementation(async (_dir, _scope, cursor) =>
    cursor === null
      ? page([pull(3), pull(2)], { nextCursor: "c1", total: 4 })
      : page([pull(2), pull(1)], { nextCursor: null, total: 4 }),
  );
  const { result } = mount();
  await waitFor(() => assert.equal(result.current.feeds.open.loaded, true));
  act(() => result.current.loadMore("open"));
  await waitFor(() => assert.equal(result.current.feeds.open.pulls.length, 3));
  assert.deepEqual(
    result.current.feeds.open.pulls.map((item) => item.number),
    [3, 2, 1],
    "the seam's repeated row is dropped",
  );
  assert.equal(result.current.feeds.open.cursor, null);
  assert.deepEqual(reads().at(-1), ["/r", "open", "c1", "github", ""]);
});

test("loadMore with nothing left asks for nothing", async () => {
  vi.mocked(loadPullRequests).mockResolvedValue(page([pull(1)]));
  const { result } = mount();
  await waitFor(() => assert.equal(result.current.feeds.open.loaded, true));
  act(() => result.current.loadMore("open"));
  assert.equal(reads().length, 1);
});

test("a failed page keeps the rows, and loadMore retries it", async () => {
  vi.mocked(loadPullRequests).mockImplementation(async (_dir, _scope, cursor) => {
    if (cursor === null) return page([pull(2)], { nextCursor: "c1" });
    if (reads().length < 3) throw new Error("HTTP 502");
    return page([pull(1)]);
  });
  const { result } = mount();
  await waitFor(() => assert.equal(result.current.feeds.open.loaded, true));
  act(() => result.current.loadMore("open"));
  await waitFor(() => assert.equal(result.current.feeds.open.moreError, "HTTP 502"));
  assert.equal(result.current.feeds.open.pulls.length, 1, "what had loaded stays");
  assert.equal(result.current.feeds.open.cursor, "c1", "and the cursor still points at the failed page");
  act(() => result.current.loadMore("open"));
  await waitFor(() => assert.equal(result.current.feeds.open.pulls.length, 2));
  assert.equal(result.current.feeds.open.moreError, null);
});

test("a search reads the scope with the text and leaves the plain lists alone", async () => {
  vi.mocked(loadPullRequests).mockImplementation(async (_dir, _scope, _cursor, _provider, query) =>
    query === "" ? page([pull(1)], { total: 1 }) : page([pull(7), pull(8)], { total: 322 }),
  );
  const { result } = mount();
  await waitFor(() => assert.equal(result.current.feeds.open.loaded, true));

  act(() => result.current.setQuery("webview"));
  assert.equal(result.current.query, "webview");
  assert.equal(result.current.view.open.loaded, false, "the view is the search's, which starts empty");
  act(() => result.current.show("open"));
  await waitFor(() => assert.equal(result.current.view.open.loaded, true));
  assert.deepEqual(
    result.current.view.open.pulls.map((item) => item.number),
    [7, 8],
  );
  assert.equal(result.current.view.open.total, 322);
  assert.deepEqual(asked().at(-1), ["open", null, "webview"]);
  assert.equal(result.current.feeds.open.pulls[0].number, 1, "the plain list is untouched");

  act(() => result.current.setQuery(""));
  assert.equal(result.current.view.open.pulls[0].number, 1, "clearing the text shows the plain list again at once");
});

test("a search's next page keeps the text", async () => {
  vi.mocked(loadPullRequests).mockImplementation(async (_dir, _scope, cursor, _provider, query) =>
    query === "" ? page([pull(1)]) : cursor === null ? page([pull(7)], { nextCursor: "s1" }) : page([pull(6)]),
  );
  const { result } = mount();
  await waitFor(() => assert.equal(result.current.feeds.open.loaded, true));
  act(() => result.current.setQuery("x"));
  act(() => result.current.show("merged"));
  await waitFor(() => assert.equal(result.current.view.merged.loaded, true));
  act(() => result.current.loadMore("merged"));
  await waitFor(() => assert.equal(result.current.view.merged.pulls.length, 2));
  assert.deepEqual(asked().at(-1), ["merged", "s1", "x"]);
});

test("an answer for text that has since changed is dropped", async () => {
  let release: (value: ReturnType<typeof page>) => void = () => {};
  vi.mocked(loadPullRequests).mockImplementation((_dir, _scope, _cursor, _provider, query) =>
    query === "old" ? new Promise((resolve) => (release = resolve)) : Promise.resolve(page([pull(1)])),
  );
  const { result } = mount();
  await waitFor(() => assert.equal(result.current.feeds.open.loaded, true));
  act(() => result.current.setQuery("old"));
  act(() => result.current.show("open"));
  act(() => result.current.setQuery("new"));
  await act(async () => release(page([pull(99)])));
  assert.deepEqual(result.current.view.open.pulls, [], "the old text's rows never land in the new text's list");
  assert.equal(result.current.query, "new");
});

test("a ref change re-reads from the first page, and the other scopes too once they have been shown", async () => {
  vi.mocked(loadPullRequests).mockResolvedValue(page([pull(1)]));
  const { result, rerender } = mount();
  await waitFor(() => assert.equal(result.current.feeds.open.loaded, true));
  rerender({ r: repo({ refsDigest: "d2" }) });
  await waitFor(() => assert.equal(reads().length, 2));
  assert.deepEqual(
    asked().map((call) => call[0]),
    ["open", "open"],
    "Merged was never shown, so it is not read",
  );

  act(() => result.current.show("merged"));
  await waitFor(() => assert.equal(result.current.feeds.merged.loaded, true));
  rerender({ r: repo({ refsDigest: "d3" }) });
  await waitFor(() => assert.equal(reads().filter((call) => call[1] === "merged").length, 2));
});

test("a ref change does not retry a CLI that is missing; reload does", async () => {
  vi.mocked(loadPullRequests).mockResolvedValue(page([], { status: "cli-missing" }));
  const { result, rerender } = mount();
  await waitFor(() => assert.equal(result.current.status, "cli-missing"));
  rerender({ r: repo({ refsDigest: "d2" }) });
  assert.equal(reads().length, 1);
  act(() => result.current.reload());
  await waitFor(() => assert.equal(reads().length, 2));
});

test("a failed first read surfaces its message instead of throwing", async () => {
  vi.mocked(loadPullRequests).mockRejectedValue(new Error("HTTP 504"));
  const { result } = mount();
  await waitFor(() => assert.equal(result.current.error, "HTTP 504"));
  assert.equal(result.current.loading, false);
});

test("a sleeping tab reads nothing", () => {
  mount(repo({ sleeping: true }));
  assert.equal(reads().length, 0);
});
