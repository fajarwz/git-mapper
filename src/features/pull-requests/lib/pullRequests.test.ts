import { describe, expect, it } from "vitest";
import type { PullRequest } from "../../../types";
import {
  PR_PAGE_SIZE,
  commitChip,
  parsePullRequestPage,
  pullLinkBase,
  pullLinkUrl,
  pullRequestForRef,
  pullRequestsByBranch,
  pullRequestsByCommit,
  requestNamedInCommit,
  summarizePipeline,
  summarizeRollup,
} from "./pullRequests";
import { compactCount, pullRequestLabel, requestNoun } from "./pullRequestTone";
import { ChecksState, PullRequestProvider, PullRequestState, ReviewState } from "../../../types";
import { GitHubReview, GitHubRollup, GitHubState, GitLabMergeStatus, GitLabPipeline, GitLabState } from "./pullRequests";

function pr(over: Partial<PullRequest>): PullRequest {
  return {
    provider: PullRequestProvider.GitHub,
    number: 1,
    title: "t",
    state: PullRequestState.Open,
    author: "a",
    headBranch: "feat/x",
    baseBranch: "main",
    url: "u",
    updatedAt: "2026-01-01T00:00:00Z",
    checks: ChecksState.None,
    review: null,
    fromFork: false,
    mergeCommit: null,
    ...over,
  };
}

describe("summarizeRollup", () => {
  it("reads GitHub's one-word rollup state", () => {
    expect(summarizeRollup(GitHubRollup.Success)).toBe(ChecksState.Passing);
    expect(summarizeRollup(GitHubRollup.Failure)).toBe(ChecksState.Failing);
    expect(summarizeRollup(GitHubRollup.Error)).toBe(ChecksState.Failing);
    expect(summarizeRollup(GitHubRollup.Pending)).toBe(ChecksState.Pending);
    expect(summarizeRollup(GitHubRollup.Expected)).toBe(ChecksState.Pending);
  });

  it("reads a missing rollup (no checks on the head commit) as none", () => {
    expect(summarizeRollup(undefined)).toBe(ChecksState.None);
    expect(summarizeRollup(null)).toBe(ChecksState.None);
    expect(summarizeRollup("SOMETHING_NEW")).toBe(ChecksState.None);
  });
});

const node = (over: Record<string, unknown>) => ({
  number: 1,
  title: "t",
  state: GitHubState.Open,
  isDraft: false,
  headRefName: "b",
  baseRefName: "main",
  isCrossRepository: false,
  url: "u",
  updatedAt: "2026-01-01T00:00:00Z",
  reviewDecision: null,
  author: { login: "a" },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: GitHubRollup.Success } } }] },
  ...over,
});

const githubPage = (
  nodes: unknown[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = { hasNextPage: false, endCursor: null },
  totalCount = nodes.length,
) => JSON.stringify({ data: { repository: { pullRequests: { totalCount, pageInfo, nodes } } } });

describe("GitHub pages", () => {
  it("maps GraphQL nodes onto the neutral shape", () => {
    const raw = githubPage([
      node({ number: 13, title: "Add download", state: GitHubState.Merged, author: { login: "fajarwz" }, headRefName: "feat/nav" }),
      node({
        number: 14,
        state: GitHubState.Open,
        isDraft: true,
        author: null,
        isCrossRepository: true,
        reviewDecision: GitHubReview.ChangesRequested,
        commits: { nodes: [] },
      }),
    ]);
    const [merged, draft] = parsePullRequestPage("github", raw, null).pullRequests;
    expect(merged).toMatchObject({
      provider: PullRequestProvider.GitHub,
      number: 13,
      state: PullRequestState.Merged,
      author: "fajarwz",
      headBranch: "feat/nav",
      checks: ChecksState.Passing,
      review: null,
    });
    expect(draft).toMatchObject({ state: PullRequestState.Draft, author: "", review: ReviewState.Changes, fromFork: true, checks: ChecksState.None });
  });

  it("carries the cursor onward only while GitHub says there is another page", () => {
    const more = parsePullRequestPage("github", githubPage([node({})], { hasNextPage: true, endCursor: "abc" }, 199), null);
    expect(more.nextCursor).toBe("abc");
    expect(more.total).toBe(199);

    const last = parsePullRequestPage("github", githubPage([node({})], { hasNextPage: false, endCursor: "abc" }), "abc");
    expect(last.nextCursor).toBeNull();
  });

  it("returns an empty last page for output that is not a page", () => {
    const empty = { pullRequests: [], nextCursor: null, total: null };
    expect(parsePullRequestPage("github", "", null)).toEqual(empty);
    expect(parsePullRequestPage("github", "{}", null)).toEqual(empty);
    expect(parsePullRequestPage("github", '{"data":null}', null)).toEqual(empty);
    expect(parsePullRequestPage("gitlab", "not json", null)).toEqual(empty);
  });
});

describe("pullRequestsByBranch", () => {
  it("prefers a live PR over a finished one, then the newest", () => {
    const map = pullRequestsByBranch([
      pr({ number: 5, state: PullRequestState.Merged }),
      pr({ number: 9, state: PullRequestState.Open }),
      pr({ number: 7, state: PullRequestState.Open }),
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
      state: GitLabState.Opened,
      draft: false,
      author: { username: "fajarwz" },
      source_branch: "feat/runner",
      target_branch: "main",
      source_project_id: 10,
      target_project_id: 10,
      web_url: "https://gitlab.com/g/p/-/merge_requests/7",
      updated_at: "2026-11-16T01:56:09Z",
      head_pipeline: { status: GitLabPipeline.Running },
      detailed_merge_status: GitLabMergeStatus.NotApproved,
    },
    {
      iid: 8,
      title: "Draft: wip",
      state: GitLabState.Opened,
      work_in_progress: true,
      author: null,
      source_branch: "wip",
      target_branch: "main",
      source_project_id: 99,
      target_project_id: 10,
      web_url: "u8",
      updated_at: "2026-11-17T00:00:00Z",
    },
    { iid: 9, title: "Done", state: GitLabState.Merged, source_branch: "a", target_branch: "main", web_url: "u9", updated_at: "x", pipeline: { status: GitLabPipeline.Success } },
    { iid: 10, title: "Nope", state: GitLabState.Locked, source_branch: "b", target_branch: "main", web_url: "u10", updated_at: "x" },
  ]);

  it("maps the API's fields onto the neutral shape, with iid as the number", () => {
    const [open, draft, merged, locked] = parsePullRequestPage("gitlab", raw, null).pullRequests;
    expect(open).toMatchObject({
      provider: PullRequestProvider.GitLab,
      number: 7,
      state: PullRequestState.Open,
      author: "fajarwz",
      headBranch: "feat/runner",
      baseBranch: "main",
      url: "https://gitlab.com/g/p/-/merge_requests/7",
      checks: ChecksState.Pending,
      review: ReviewState.Required,
      fromFork: false,
      mergeCommit: null,
    });
    expect(draft).toMatchObject({ state: PullRequestState.Draft, author: "", fromFork: true, checks: ChecksState.None, review: null });
    expect(merged).toMatchObject({ state: PullRequestState.Merged, checks: ChecksState.Passing });
    expect(locked.state).toBe(PullRequestState.Closed);
  });

  it("reads a pipeline status into a checks state", () => {
    expect(summarizePipeline(undefined)).toBe(ChecksState.None);
    expect(summarizePipeline(GitLabPipeline.Success)).toBe(ChecksState.Passing);
    expect(summarizePipeline(GitLabPipeline.Failed)).toBe(ChecksState.Failing);
    expect(summarizePipeline(GitLabPipeline.Canceled)).toBe(ChecksState.Failing);
    expect(summarizePipeline(GitLabPipeline.Running)).toBe(ChecksState.Pending);
    expect(summarizePipeline(GitLabPipeline.Skipped)).toBe(ChecksState.None);
  });

  it("pages by number: a full page may have a successor, a short one is the last", () => {
    const item = (iid: number) => ({ iid, title: "t", state: GitLabState.Opened, source_branch: "b", target_branch: "main", web_url: "u", updated_at: "x" });
    const full = JSON.stringify(Array.from({ length: PR_PAGE_SIZE }, (_, index) => item(index + 1)));
    expect(parsePullRequestPage("gitlab", full, null).nextCursor).toBe("2");
    expect(parsePullRequestPage("gitlab", full, "3").nextCursor).toBe("4");
    expect(parsePullRequestPage("gitlab", JSON.stringify([item(1)]), "3").nextCursor).toBeNull();
    expect(parsePullRequestPage("gitlab", full, null).total).toBeNull();
  });

  it("writes !7 where GitHub writes #7, and says merge request", () => {
    expect(pullRequestLabel(pr({ provider: PullRequestProvider.GitLab, number: 7 }))).toBe("!7");
    expect(pullRequestLabel(pr({ provider: PullRequestProvider.GitHub, number: 7 }))).toBe("#7");
    expect(requestNoun("gitlab", true)).toBe("Merge requests");
    expect(requestNoun(null)).toBe("Pull request");
  });
});

describe("compactCount", () => {
  it("keeps small counts whole and shortens thousands", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(199)).toBe("199");
    expect(compactCount(1000)).toBe("1k");
    expect(compactCount(7213)).toBe("7.2k");
    expect(compactCount(12400)).toBe("12k");
  });
});

describe("GitHub search pages", () => {
  const search = JSON.stringify({
    data: {
      search: {
        issueCount: 322,
        pageInfo: { hasNextPage: true, endCursor: "Y3Vyc29yOjMw" },
        nodes: [node({ number: 16456, state: GitHubState.Merged }), {}],
      },
    },
  });

  it("reads the count from issueCount and ignores nodes that are not pull requests", () => {
    const page = parsePullRequestPage("github", search, null);
    expect(page.pullRequests.map((item) => item.number)).toEqual([16456]);
    expect(page.pullRequests[0].state).toBe(PullRequestState.Merged);
    expect(page.total).toBe(322);
    expect(page.nextCursor).toBe("Y3Vyc29yOjMw");
  });
});

describe("the commit a request made", () => {
  const merged = (over: Partial<PullRequest>) =>
    pr({ state: PullRequestState.Merged, number: 14, title: "Add chips", url: "https://github.com/o/r/pull/14", mergeCommit: "a".repeat(40), ...over });

  it("reads the merge commit from either provider, preferring GitLab's squash commit", () => {
    const github = parsePullRequestPage("github", githubPage([node({ state: GitHubState.Merged, mergeCommit: { oid: "abc123" } }), node({})]), null);
    expect(github.pullRequests.map((item) => item.mergeCommit)).toEqual(["abc123", null]);

    const gitlab = parsePullRequestPage(
      "gitlab",
      JSON.stringify([
        { iid: 1, title: "t", state: GitLabState.Merged, source_branch: "b", target_branch: "main", web_url: "u", updated_at: "x", merge_commit_sha: "m1", squash_commit_sha: "s1" },
        { iid: 2, title: "t", state: GitLabState.Merged, source_branch: "b", target_branch: "main", web_url: "u", updated_at: "x", merge_commit_sha: "m2", squash_commit_sha: null },
        { iid: 3, title: "t", state: GitLabState.Opened, source_branch: "b", target_branch: "main", web_url: "u", updated_at: "x" },
      ]),
      null,
    );
    expect(gitlab.pullRequests.map((item) => item.mergeCommit)).toEqual(["s1", "m2", null]);
  });

  it("indexes merged requests by the commit they made", () => {
    const byCommit = pullRequestsByCommit([merged({}), pr({ number: 2 })]);
    expect([...byCommit.keys()]).toEqual(["a".repeat(40)]);
    expect(byCommit.get("a".repeat(40))?.number).toBe(14);
  });

  it("reads the request a commit's own text names", () => {
    expect(requestNamedInCommit("feat: add chips (#14)")).toEqual({ provider: PullRequestProvider.GitHub, number: 14 });
    expect(requestNamedInCommit("Merge pull request #7 from o/branch")).toEqual({ provider: PullRequestProvider.GitHub, number: 7 });
    expect(requestNamedInCommit("Merge branch 'x' into 'main'", "\nSee merge request g/p!21\n")).toEqual({ provider: PullRequestProvider.GitLab, number: 21 });
    expect(requestNamedInCommit("fix (#14) typo in the middle, not a squash suffix")).toBeNull();
    expect(requestNamedInCommit("just a commit")).toBeNull();
  });

  it("builds a link from any loaded request's address, for either provider", () => {
    expect(pullLinkBase([pr({ url: "https://github.com/o/r/pull/9" })])).toEqual({ provider: PullRequestProvider.GitHub, base: "https://github.com/o/r" });
    const gitlab = pullLinkBase([pr({ provider: PullRequestProvider.GitLab, url: "https://gitlab.com/g/p/-/merge_requests/3" })]);
    expect(gitlab).toEqual({ provider: PullRequestProvider.GitLab, base: "https://gitlab.com/g/p" });
    expect(pullLinkUrl(gitlab!, 21)).toBe("https://gitlab.com/g/p/-/merge_requests/21");
    expect(pullLinkUrl({ provider: PullRequestProvider.GitHub, base: "https://github.com/o/r" }, 14)).toBe("https://github.com/o/r/pull/14");
    expect(pullLinkBase([pr({ url: "u" })])).toBeNull();
  });

  it("chips a commit by the exact request first, then by the number its message names", () => {
    const hash = "a".repeat(40);
    const byCommit = pullRequestsByCommit([merged({})]);
    const link = { provider: PullRequestProvider.GitHub as const, base: "https://github.com/o/r" };

    const exact = commitChip({ hash, subject: "no number here" }, byCommit, link);
    expect(exact).toMatchObject({ number: 14, state: PullRequestState.Merged, url: "https://github.com/o/r/pull/14" });
    expect(exact?.tooltip).toContain("Add chips");

    const named = commitChip({ hash: "b".repeat(40), subject: "older work (#9)" }, byCommit, link);
    expect(named).toMatchObject({ number: 9, state: PullRequestState.Merged, url: "https://github.com/o/r/pull/9" });
    expect(named?.tooltip).toContain("named in this commit's message");
  });

  it("chips nothing it cannot link: no known address, another provider, or no number", () => {
    const none = new Map<string, PullRequest>();
    const link = { provider: PullRequestProvider.GitHub as const, base: "https://github.com/o/r" };
    expect(commitChip({ hash: "c", subject: "x (#9)" }, none, null)).toBeNull();
    expect(commitChip({ hash: "c", subject: "x", body: "See merge request g/p!3" }, none, link)).toBeNull();
    expect(commitChip({ hash: "c", subject: "plain" }, none, link)).toBeNull();
  });
});
