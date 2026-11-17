import { describe, expect, it } from "vitest";
import type { PullRequest } from "../types";
import {
  parsePullRequests,
  pullRequestForRef,
  pullRequestsByBranch,
  summarizeChecks,
  summarizePipeline,
} from "./pullRequests";
import { pullRequestLabel, requestNoun } from "./pullRequestTone";

function pr(over: Partial<PullRequest>): PullRequest {
  return {
    provider: "github",
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
    const [merged, draft] = parsePullRequests("github", raw);
    expect(merged).toMatchObject({ number: 13, state: "merged", author: "fajarwz", checks: "passing", review: null });
    expect(draft).toMatchObject({ state: "draft", author: "", review: "changes", fromFork: true, checks: "none" });
  });

  it("returns nothing for output that is not a list", () => {
    expect(parsePullRequests("github", "")).toEqual([]);
    expect(parsePullRequests("gitlab", "{}")).toEqual([]);
    expect(parsePullRequests("gitlab", "not json")).toEqual([]);
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

describe("GitLab merge requests", () => {
  const raw = JSON.stringify([
    {
      iid: 7,
      title: "Add runner",
      state: "opened",
      draft: false,
      author: { username: "fajarwz" },
      source_branch: "feat/runner",
      target_branch: "main",
      source_project_id: 10,
      target_project_id: 10,
      web_url: "https://gitlab.com/g/p/-/merge_requests/7",
      updated_at: "2026-11-16T01:56:09Z",
      head_pipeline: { status: "running" },
      detailed_merge_status: "not_approved",
    },
    {
      iid: 8,
      title: "Draft: wip",
      state: "opened",
      work_in_progress: true,
      author: null,
      source_branch: "wip",
      target_branch: "main",
      source_project_id: 99,
      target_project_id: 10,
      web_url: "u8",
      updated_at: "2026-11-17T00:00:00Z",
    },
    { iid: 9, title: "Done", state: "merged", source_branch: "a", target_branch: "main", web_url: "u9", updated_at: "x", pipeline: { status: "success" } },
    { iid: 10, title: "Nope", state: "locked", source_branch: "b", target_branch: "main", web_url: "u10", updated_at: "x" },
  ]);

  it("maps the API's fields onto the neutral shape, with iid as the number", () => {
    const [open, draft, merged, locked] = parsePullRequests("gitlab", raw);
    expect(open).toMatchObject({
      provider: "gitlab",
      number: 7,
      state: "open",
      author: "fajarwz",
      headBranch: "feat/runner",
      baseBranch: "main",
      url: "https://gitlab.com/g/p/-/merge_requests/7",
      checks: "pending",
      review: "required",
      fromFork: false,
    });
    expect(draft).toMatchObject({ state: "draft", author: "", fromFork: true, checks: "none", review: null });
    expect(merged).toMatchObject({ state: "merged", checks: "passing" });
    expect(locked.state).toBe("closed");
  });

  it("reads a pipeline status into a checks state", () => {
    expect(summarizePipeline(undefined)).toBe("none");
    expect(summarizePipeline("success")).toBe("passing");
    expect(summarizePipeline("failed")).toBe("failing");
    expect(summarizePipeline("canceled")).toBe("failing");
    expect(summarizePipeline("running")).toBe("pending");
    expect(summarizePipeline("skipped")).toBe("none");
  });

  it("writes !7 where GitHub writes #7, and says merge request", () => {
    expect(pullRequestLabel(pr({ provider: "gitlab", number: 7 }))).toBe("!7");
    expect(pullRequestLabel(pr({ provider: "github", number: 7 }))).toBe("#7");
    expect(requestNoun("gitlab", true)).toBe("Merge requests");
    expect(requestNoun(null)).toBe("Pull request");
  });
});
