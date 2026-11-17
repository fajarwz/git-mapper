// Per-repo PR reads: loads once per repo, re-reads on a ref change only while gh answers.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, test, vi } from "vitest";

import { usePullRequests } from "./usePullRequests";
import { loadPullRequests } from "../data/gitLoader";
import type { PullRequest, Repository } from "../types";

vi.mock("../data/gitLoader", () => ({ loadPullRequests: vi.fn() }));

const pull: PullRequest = {
  number: 1,
  title: "t",
  state: "open",
  author: "a",
  headBranch: "feat/x",
  baseBranch: "main",
  url: "u",
  updatedAt: "2026-01-01T00:00:00Z",
  checks: "none",
  review: null,
  fromFork: false,
};

const repo = (over: Partial<Repository> = {}) => ({ path: "/r", refsDigest: "d1", ...over }) as Repository;

beforeEach(() => {
  vi.mocked(loadPullRequests).mockReset();
});

test("reads once for a repo and exposes the branch lookup", async () => {
  vi.mocked(loadPullRequests).mockResolvedValue({ status: "ok", pullRequests: [pull] });
  const { result } = renderHook(({ r }) => usePullRequests(r), { initialProps: { r: repo() } });
  await waitFor(() => assert.equal(result.current.status, "ok"));
  assert.equal(result.current.byBranch.get("feat/x")?.number, 1);
  assert.equal(vi.mocked(loadPullRequests).mock.calls.length, 1);
});

test("a ref change re-reads while gh answers", async () => {
  vi.mocked(loadPullRequests).mockResolvedValue({ status: "ok", pullRequests: [pull] });
  const { result, rerender } = renderHook(({ r }) => usePullRequests(r), { initialProps: { r: repo() } });
  await waitFor(() => assert.equal(result.current.status, "ok"));
  rerender({ r: repo({ refsDigest: "d2" }) });
  await waitFor(() => assert.equal(vi.mocked(loadPullRequests).mock.calls.length, 2));
});

test("a ref change does not retry a gh that is missing; reload does", async () => {
  vi.mocked(loadPullRequests).mockResolvedValue({ status: "gh-missing", pullRequests: [] });
  const { result, rerender } = renderHook(({ r }) => usePullRequests(r), { initialProps: { r: repo() } });
  await waitFor(() => assert.equal(result.current.status, "gh-missing"));
  rerender({ r: repo({ refsDigest: "d2" }) });
  assert.equal(vi.mocked(loadPullRequests).mock.calls.length, 1);
  act(() => result.current.reload());
  await waitFor(() => assert.equal(vi.mocked(loadPullRequests).mock.calls.length, 2));
});

test("a failed read surfaces its message instead of throwing", async () => {
  vi.mocked(loadPullRequests).mockRejectedValue(new Error("HTTP 502"));
  const { result } = renderHook(({ r }) => usePullRequests(r), { initialProps: { r: repo() } });
  await waitFor(() => assert.equal(result.current.error, "HTTP 502"));
  assert.equal(result.current.loading, false);
});

test("a sleeping tab reads nothing", () => {
  renderHook(() => usePullRequests(repo({ sleeping: true })));
  assert.equal(vi.mocked(loadPullRequests).mock.calls.length, 0);
});
