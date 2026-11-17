import type { PullRequest, PullRequestState } from "../types";

/** Token colour and wording per PR state, shared by the pill badge and the list rows. */
export const PR_STATE: Record<PullRequestState, { label: string; color: string }> = {
  open: { label: "Open", color: "var(--color-success)" },
  draft: { label: "Draft", color: "var(--color-ink-dim)" },
  merged: { label: "Merged", color: "var(--color-primary)" },
  closed: { label: "Closed", color: "var(--color-danger)" },
};

const CHECKS = { passing: "checks passing", failing: "checks failing", pending: "checks running" } as const;
const REVIEWS = { approved: "approved", changes: "changes requested", required: "review required" } as const;

/** "Open · checks passing · approved": the one-line status a tooltip or row subtitle reads. */
export function describePullRequest(pull: PullRequest): string {
  const parts: string[] = [PR_STATE[pull.state].label];
  if (pull.checks !== "none") parts.push(CHECKS[pull.checks]);
  if (pull.review !== null) parts.push(REVIEWS[pull.review]);
  return parts.join(" · ");
}
