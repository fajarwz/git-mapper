// Per-repo PR reads: Open on arrival, All on demand, a page at a time, and no pointless retries.
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

beforeEach(() => {
  vi.mocked(loadPullRequests).mockReset();
});

test("reads the open list on arrival and exposes the branch lookup", async () => {
  vi.mocked(loadPullRequests).mockResolvedValue(page([pull(1)], { nextCursor: "c1", total: 199 }));
  const { result } = mount();
  await waitFor(() => assert.equal(result.current.status, "ok"));
  assert.deepEqual(reads(), [["/r", "open", null, null]]);
  assert.equal(result.current.open.total, 199);
  assert.equal(result.current.open.cursor, "c1");
  assert.equal(result.current.byBranch.get("feat/1")?.number, 1);
  assert.equal(result.current.all.loaded, false, "All waits until it is asked for");
});

test("All is read the first time it is shown, and reused after", async () => {
  vi.mocked(loadPullRequests).mockImplementation(async (_dir, scope) =>
    scope === "open" ? page([pull(1)]) : page([pull(1), pull(2, { state: "merged" })], { total: 7213 }),
  );
  const { result } = mount();
  await waitFor(() => assert.equal(result.current.open.loaded, true));
  act(() => result.current.showAll());
  await waitFor(() => assert.equal(result.current.all.loaded, true));
  assert.equal(result.current.all.total, 7213);
  act(() => result.current.showAll());
  assert.equal(reads().filter((call) => call[1] === "all").length, 1);
});

test("loadMore asks for the next page of the same provider and appends it without repeats", async () => {
  vi.mocked(loadPullRequests).mockImplementation(async (_dir, _scope, cursor) =>
    cursor === null
      ? page([pull(3), pull(2)], { nextCursor: "c1", total: 4 })
      : page([pull(2), pull(1)], { nextCursor: null, total: 4 }),
  );
  const { result } = mount();
  await waitFor(() => assert.equal(result.current.open.loaded, true));
  act(() => result.current.loadMore("open"));
  await waitFor(() => assert.equal(result.current.open.pulls.length, 3));
  assert.deepEqual(
    result.current.open.pulls.map((item) => item.number),
    [3, 2, 1],
    "the seam's repeated row is dropped",
  );
  assert.equal(result.current.open.cursor, null);
  assert.deepEqual(reads().at(-1), ["/r", "open", "c1", "github"]);
});

test("loadMore with nothing left asks for nothing", async () => {
  vi.mocked(loadPullRequests).mockResolvedValue(page([pull(1)]));
  const { result } = mount();
  await waitFor(() => assert.equal(result.current.open.loaded, true));
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
  await waitFor(() => assert.equal(result.current.open.loaded, true));
  act(() => result.current.loadMore("open"));
  await waitFor(() => assert.equal(result.current.open.moreError, "HTTP 502"));
  assert.equal(result.current.open.pulls.length, 1, "what had loaded stays");
  assert.equal(result.current.open.cursor, "c1", "and the cursor still points at the failed page");
  act(() => result.current.loadMore("open"));
  await waitFor(() => assert.equal(result.current.open.pulls.length, 2));
  assert.equal(result.current.open.moreError, null);
});

test("a ref change re-reads from the first page, and All too once it has been shown", async () => {
  vi.mocked(loadPullRequests).mockResolvedValue(page([pull(1)]));
  const { result, rerender } = mount();
  await waitFor(() => assert.equal(result.current.open.loaded, true));
  rerender({ r: repo({ refsDigest: "d2" }) });
  await waitFor(() => assert.equal(reads().length, 2));
  assert.deepEqual(
    reads().map((call) => [call[1], call[2]]),
    [["open", null], ["open", null]],
    "All was never shown, so it is not read",
  );

  act(() => result.current.showAll());
  await waitFor(() => assert.equal(result.current.all.loaded, true));
  rerender({ r: repo({ refsDigest: "d3" }) });
  await waitFor(() => assert.equal(reads().filter((call) => call[1] === "all").length, 2));
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
