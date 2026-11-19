import { ChecksState, PullRequestProvider, PullRequestState, ReviewState, type PullRequest } from "../../../types";

/**
 * Wording and tone per PR state, shared by the pill chip and the list rows. Draft stays quiet
 * (grey); open, merged and closed each get their own hue so closed is never mistaken for draft.
 */
export const PR_STATE: Record<PullRequestState, { label: string; text: string; tile: string }> = {
  [PullRequestState.Open]: { label: "Open", text: "text-success-ink", tile: "bg-success/15" },
  [PullRequestState.Draft]: { label: "Draft", text: "text-ink-dim", tile: "bg-ink/10" },
  [PullRequestState.Merged]: { label: "Merged", text: "text-primary-ink", tile: "bg-primary/15" },
  [PullRequestState.Closed]: { label: "Closed", text: "text-danger-ink", tile: "bg-danger/15" },
};

export const CHECK_TONE = {
  [ChecksState.Passing]: { label: "Checks passing", chip: "bg-success/15 text-success-ink" },
  [ChecksState.Failing]: { label: "Checks failing", chip: "bg-danger/15 text-danger-ink" },
  [ChecksState.Pending]: { label: "Checks running", chip: "bg-warning/15 text-warning-ink" },
} as const;

export const REVIEW_TONE = {
  [ReviewState.Approved]: { label: "Approved", chip: "bg-success/15 text-success-ink" },
  [ReviewState.Changes]: { label: "Changes requested", chip: "bg-warning/15 text-warning-ink" },
  [ReviewState.Required]: { label: "Review required", chip: "bg-ink/10 text-ink-soft" },
} as const;

export function compactCount(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
}

export const PROVIDER_NAME: Record<PullRequestProvider, string> = {
  [PullRequestProvider.GitHub]: "GitHub",
  [PullRequestProvider.GitLab]: "GitLab",
};

export function pullRequestLabel(pull: Pick<PullRequest, "provider" | "number">): string {
  return `${pull.provider === PullRequestProvider.GitLab ? "!" : "#"}${pull.number}`;
}

export function requestNoun(provider: PullRequestProvider | null, plural = false): string {
  const noun = provider === PullRequestProvider.GitLab ? "Merge request" : "Pull request";
  return plural ? `${noun}s` : noun;
}

const CHECKS = {
  [ChecksState.Passing]: "checks passing",
  [ChecksState.Failing]: "checks failing",
  [ChecksState.Pending]: "checks running",
} as const;
const REVIEWS = {
  [ReviewState.Approved]: "approved",
  [ReviewState.Changes]: "changes requested",
  [ReviewState.Required]: "review required",
} as const;

export function describePullRequest(pull: PullRequest): string {
  const parts: string[] = [PR_STATE[pull.state].label];
  if (pull.checks !== ChecksState.None) parts.push(CHECKS[pull.checks]);
  if (pull.review !== null) parts.push(REVIEWS[pull.review]);
  return parts.join(" · ");
}
