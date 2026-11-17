import type { ChecksState, CommitRef, PullRequest, PullRequestProvider, PullRequestState } from "../types";

interface RawCheck {
  status?: string;
  conclusion?: string;
  state?: string;
}

interface RawPullRequest {
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
  statusCheckRollup?: RawCheck[] | null;
}

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

/** CheckRun entries carry status + conclusion; legacy StatusContext entries carry a single state. */
export function summarizeChecks(rollup: RawCheck[] | null | undefined): ChecksState {
  if (!rollup || rollup.length === 0) return "none";
  let pending = false;
  for (const check of rollup) {
    const verdict = check.conclusion || check.state || "";
    if (FAILED.has(verdict)) return "failing";
    if ((check.status && check.status !== "COMPLETED") || verdict === "PENDING" || verdict === "EXPECTED") {
      pending = true;
    }
  }
  return pending ? "pending" : "passing";
}

function stateOf(raw: RawPullRequest): PullRequestState {
  if (raw.state === "MERGED") return "merged";
  if (raw.state === "CLOSED") return "closed";
  return raw.isDraft ? "draft" : "open";
}

const REVIEWS: Record<string, PullRequest["review"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes",
  REVIEW_REQUIRED: "required",
};

function parseList(raw: string): unknown[] {
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
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

function parseGitLab(raw: string): PullRequest[] {
  return (parseList(raw) as RawMergeRequest[]).map((item) => ({
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
  }));
}

/**
 * Shapes the provider CLI's JSON (`gh pr list` / `glab mr list`) into one PullRequest type.
 * Garbage in (a CLI that printed something else) → none out.
 */
export function parsePullRequests(provider: PullRequestProvider, raw: string): PullRequest[] {
  if (provider === "gitlab") return parseGitLab(raw);
  return (parseList(raw) as RawPullRequest[]).map((item) => ({
    provider: "github",
    number: item.number,
    title: item.title,
    state: stateOf(item),
    author: item.author?.login ?? "",
    headBranch: item.headRefName,
    baseBranch: item.baseRefName,
    url: item.url,
    updatedAt: item.updatedAt,
    checks: summarizeChecks(item.statusCheckRollup),
    review: REVIEWS[item.reviewDecision ?? ""] ?? null,
    fromFork: item.isCrossRepository === true,
  }));
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
