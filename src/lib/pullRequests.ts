import type { ChecksState, CommitRef, PullRequest, PullRequestState } from "../types";

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

/** Shapes `gh pr list --json` output. Garbage in (a gh that printed something else) → none out. */
export function parsePullRequests(raw: string): PullRequest[] {
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return (list as RawPullRequest[]).map((item) => ({
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
