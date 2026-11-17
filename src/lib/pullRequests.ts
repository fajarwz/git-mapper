import type { ChecksState, CommitRef, PullRequest, PullRequestProvider, PullRequestState } from "../types";

/** Rows per read. Must match PAGE_SIZE in src-tauri/src/git/pulls.rs: a full GitLab page is
 * how "there may be another page" is told, since glab reports no total. */
export const PR_PAGE_SIZE = 30;

export interface PullRequestPage {
  pullRequests: PullRequest[];
  /** Opaque, provider-specific: pass it back to read the next page; null when this was the last. */
  nextCursor: string | null;
  /** Every request in the scope, not just this page; null when the provider does not say. */
  total: number | null;
}

interface RawNode {
  number: number;
  title: string;
  state: string;
  isDraft?: boolean;
  author?: { login?: string } | null;
  headRefName: string;
  baseRefName: string;
  isCrossRepository?: boolean;
  url: string;
  updatedAt: string;
  reviewDecision?: string | null;
  commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: { state?: string } | null } | null }> } | null;
}

interface RawConnection {
  totalCount?: number;
  /** A search reports its count as issueCount, and its nodes may be empty objects for non-PRs. */
  issueCount?: number;
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  nodes?: RawNode[];
}

interface RawGitHubPage {
  data?: {
    repository?: { pullRequests?: RawConnection } | null;
    search?: RawConnection | null;
  } | null;
}

/** GitHub's rollup `state` for the head commit: one word, not the list of every check. */
export function summarizeRollup(state: string | undefined | null): ChecksState {
  if (state === "SUCCESS") return "passing";
  if (state === "FAILURE" || state === "ERROR") return "failing";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  return "none";
}

function stateOf(raw: RawNode): PullRequestState {
  if (raw.state === "MERGED") return "merged";
  if (raw.state === "CLOSED") return "closed";
  return raw.isDraft ? "draft" : "open";
}

const REVIEWS: Record<string, PullRequest["review"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes",
  REVIEW_REQUIRED: "required",
};

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseGitHub(raw: string): PullRequestPage {
  const data = (parseJson(raw) as RawGitHubPage | null)?.data;
  const page = data?.repository?.pullRequests ?? data?.search ?? undefined;
  const nodes = (Array.isArray(page?.nodes) ? page.nodes : []).filter((item) => typeof item?.number === "number");
  const pageInfo = page?.pageInfo;
  return {
    pullRequests: nodes.map((item) => ({
      provider: "github",
      number: item.number,
      title: item.title,
      state: stateOf(item),
      author: item.author?.login ?? "",
      headBranch: item.headRefName,
      baseBranch: item.baseRefName,
      url: item.url,
      updatedAt: item.updatedAt,
      checks: summarizeRollup(item.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state),
      review: REVIEWS[item.reviewDecision ?? ""] ?? null,
      fromFork: item.isCrossRepository === true,
    })),
    nextCursor: pageInfo?.hasNextPage === true && pageInfo.endCursor ? pageInfo.endCursor : null,
    total:
      typeof page?.totalCount === "number"
        ? page.totalCount
        : typeof page?.issueCount === "number"
          ? page.issueCount
          : null,
  };
}

interface RawMergeRequest {
  iid: number;
  title: string;
  state: string;
  draft?: boolean;
  work_in_progress?: boolean;
  author?: { username?: string } | null;
  source_branch: string;
  target_branch: string;
  source_project_id?: number;
  target_project_id?: number;
  web_url: string;
  updated_at: string;
  head_pipeline?: { status?: string } | null;
  pipeline?: { status?: string } | null;
  detailed_merge_status?: string;
}

const PIPELINE_FAILED = new Set(["failed", "canceled", "cancelled"]);
const PIPELINE_WAITING = new Set([
  "created",
  "waiting_for_resource",
  "preparing",
  "pending",
  "running",
  "manual",
  "scheduled",
]);

/** The list endpoint may leave the pipeline out entirely; no pipeline reads as no checks. */
export function summarizePipeline(status: string | undefined): ChecksState {
  if (!status) return "none";
  if (PIPELINE_FAILED.has(status)) return "failing";
  if (PIPELINE_WAITING.has(status)) return "pending";
  return status === "success" ? "passing" : "none";
}

function gitlabState(raw: RawMergeRequest): PullRequestState {
  if (raw.state === "merged") return "merged";
  if (raw.state === "closed" || raw.state === "locked") return "closed";
  return raw.draft === true || raw.work_in_progress === true ? "draft" : "open";
}

function parseGitLab(raw: string, cursor: string | null): PullRequestPage {
  const list = parseJson(raw);
  const items = Array.isArray(list) ? (list as RawMergeRequest[]) : [];
  const page = Number.parseInt(cursor ?? "", 10);
  return {
    pullRequests: items.map((item) => ({
      provider: "gitlab",
      number: item.iid,
      title: item.title,
      state: gitlabState(item),
      author: item.author?.username ?? "",
      headBranch: item.source_branch,
      baseBranch: item.target_branch,
      url: item.web_url,
      updatedAt: item.updated_at,
      checks: summarizePipeline((item.head_pipeline ?? item.pipeline)?.status),
      // The list carries no approvals; only "needs approval" is stated outright.
      review: item.detailed_merge_status === "not_approved" ? "required" : null,
      fromFork:
        item.source_project_id !== undefined &&
        item.target_project_id !== undefined &&
        item.source_project_id !== item.target_project_id,
    })),
    // glab pages by number and reports no total: a full page may have a successor.
    nextCursor: items.length >= PR_PAGE_SIZE ? String((Number.isFinite(page) && page > 0 ? page : 1) + 1) : null,
    total: null,
  };
}

/**
 * Shapes one page of the provider CLI's output into the neutral PullRequest type. `cursor` is
 * the one the page was requested with (GitLab's next page is derived from it). Garbage in (a
 * CLI that printed something else) → an empty last page out.
 */
export function parsePullRequestPage(
  provider: PullRequestProvider,
  raw: string,
  cursor: string | null,
): PullRequestPage {
  return provider === "gitlab" ? parseGitLab(raw, cursor) : parseGitHub(raw);
}

const PRIORITY: Record<PullRequestState, number> = { open: 0, draft: 1, merged: 2, closed: 3 };

/**
 * Branch name → the PR to wear on its pill. A branch can have several over time (a closed one,
 * then a reopened attempt), so a live PR wins over a finished one, then the most recent.
 * Fork PRs are skipped: their head name belongs to someone else's repository.
 */
export function pullRequestsByBranch(pulls: PullRequest[]): Map<string, PullRequest> {
  const byBranch = new Map<string, PullRequest>();
  for (const pull of pulls) {
    if (pull.fromFork) continue;
    const current = byBranch.get(pull.headBranch);
    if (
      !current ||
      PRIORITY[pull.state] < PRIORITY[current.state] ||
      (PRIORITY[pull.state] === PRIORITY[current.state] && pull.number > current.number)
    ) {
      byBranch.set(pull.headBranch, pull);
    }
  }
  return byBranch;
}

/** The PR for a pill: a local branch by its name, a remote-tracking one by its name past `<remote>/`. */
export function pullRequestForRef(ref: CommitRef, byBranch: Map<string, PullRequest>): PullRequest | undefined {
  if (ref.type === "branch") return byBranch.get(ref.name);
  if (ref.type === "remote") return byBranch.get(ref.name.slice(ref.name.indexOf("/") + 1));
  return undefined;
}
