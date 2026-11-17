import { describe, expect, it } from "vitest";
import type { PullRequest } from "../types";
import { parsePullRequests, pullRequestForRef, pullRequestsByBranch, summarizeChecks } from "./pullRequests";

function pr(over: Partial<PullRequest>): PullRequest {
  return {
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
    ...over,
  };
}

describe("summarizeChecks", () => {
  it("reads no rollup as none", () => {
    expect(summarizeChecks([])).toBe("none");
    expect(summarizeChecks(null)).toBe("none");
  });

  it("fails on any failed run, even with others still pending", () => {
    expect(
      summarizeChecks([
        { status: "IN_PROGRESS" },
        { status: "COMPLETED", conclusion: "FAILURE" },
      ]),
    ).toBe("failing");
  });

  it("is pending while any run is unfinished or a legacy status is pending", () => {
    expect(summarizeChecks([{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "QUEUED" }])).toBe("pending");
    expect(summarizeChecks([{ state: "PENDING" }])).toBe("pending");
  });

  it("passes when everything finished green (skipped and neutral count)", () => {
    expect(
      summarizeChecks([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "COMPLETED", conclusion: "SKIPPED" },
        { state: "SUCCESS" },
      ]),
    ).toBe("passing");
  });
});

describe("parsePullRequests", () => {
  const raw = JSON.stringify([
    {
      number: 13,
      title: "Add download",
      state: "MERGED",
      isDraft: false,
      author: { login: "fajarwz" },
      headRefName: "feat/nav",
      baseRefName: "main",
      isCrossRepository: false,
      url: "https://github.com/o/r/pull/13",
      updatedAt: "2026-11-16T01:56:09Z",
      reviewDecision: "",
      statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
    },
    {
      number: 14,
      title: "WIP",
      state: "OPEN",
      isDraft: true,
      author: null,
      headRefName: "wip",
      baseRefName: "main",
      isCrossRepository: true,
      url: "https://github.com/o/r/pull/14",
      updatedAt: "2026-11-17T00:00:00Z",
      reviewDecision: "CHANGES_REQUESTED",
      statusCheckRollup: null,
    },
  ]);

  it("maps gh's fields onto the neutral shape", () => {
    const [merged, draft] = parsePullRequests(raw);
    expect(merged).toMatchObject({ number: 13, state: "merged", author: "fajarwz", checks: "passing", review: null });
    expect(draft).toMatchObject({ state: "draft", author: "", review: "changes", fromFork: true, checks: "none" });
  });

  it("returns nothing for output that is not a list", () => {
    expect(parsePullRequests("")).toEqual([]);
    expect(parsePullRequests("{}")).toEqual([]);
    expect(parsePullRequests("not json")).toEqual([]);
  });
});

describe("pullRequestsByBranch", () => {
  it("prefers a live PR over a finished one, then the newest", () => {
    const map = pullRequestsByBranch([
      pr({ number: 5, state: "merged" }),
      pr({ number: 9, state: "open" }),
      pr({ number: 7, state: "open" }),
    ]);
    expect(map.get("feat/x")?.number).toBe(9);
  });

  it("ignores fork PRs so a fork's main never decorates ours", () => {
    const map = pullRequestsByBranch([pr({ headBranch: "main", fromFork: true })]);
    expect(map.has("main")).toBe(false);
  });
});

describe("pullRequestForRef", () => {
  const map = pullRequestsByBranch([pr({ headBranch: "feat/x" })]);

  it("matches a local branch by name and a remote one past its remote name", () => {
    expect(pullRequestForRef({ type: "branch", name: "feat/x" }, map)?.number).toBe(1);
    expect(pullRequestForRef({ type: "remote", name: "origin/feat/x" }, map)?.number).toBe(1);
  });

  it("leaves tags, stashes and unknown branches bare", () => {
    expect(pullRequestForRef({ type: "tag", name: "feat/x" }, map)).toBeUndefined();
    expect(pullRequestForRef({ type: "branch", name: "other" }, map)).toBeUndefined();
  });
});
