import type { PullRequest, PullRequestProvider, PullRequestState } from "../types";

/**
 * Wording and tone per PR state, shared by the pill chip and the list rows. Only live work
 * (open) speaks in colour; finished states stay quiet, so a long All list is not a rainbow and
 * draft vs closed is told apart by glyph, not hue.
 */
export const PR_STATE: Record<PullRequestState, { label: string; text: string; tile: string }> = {
  open: { label: "Open", text: "text-success-ink", tile: "bg-success/15" },
  draft: { label: "Draft", text: "text-ink-dim", tile: "bg-ink/10" },
  merged: { label: "Merged", text: "text-primary-ink", tile: "bg-primary/15" },
  closed: { label: "Closed", text: "text-ink-dim", tile: "bg-ink/10" },
};

/** The two status chips under a row's title: the tint pair is `bg-X/15` + `text-X-ink`. */
export const CHECK_TONE = {
  passing: { label: "Checks passing", chip: "bg-success/15 text-success-ink" },
  failing: { label: "Checks failing", chip: "bg-danger/15 text-danger-ink" },
  pending: { label: "Checks running", chip: "bg-warning/15 text-warning-ink" },
} as const;

export const REVIEW_TONE = {
  approved: { label: "Approved", chip: "bg-success/15 text-success-ink" },
  changes: { label: "Changes requested", chip: "bg-warning/15 text-warning-ink" },
  required: { label: "Review required", chip: "bg-ink/10 text-ink-soft" },
} as const;

/** 412 → "412", 7213 → "7.2k": a repo's All total can be in the thousands. */
export function compactCount(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
}

export const PROVIDER_NAME: Record<PullRequestProvider, string> = { github: "GitHub", gitlab: "GitLab" };

/** GitHub writes `#13`, GitLab writes `!13` (`#` is its issue prefix). */
export function pullRequestLabel(pull: Pick<PullRequest, "provider" | "number">): string {
  return `${pull.provider === "gitlab" ? "!" : "#"}${pull.number}`;
}

/** What the provider calls the thing, for headings and hints. Unknown reads as GitHub's term. */
export function requestNoun(provider: PullRequestProvider | null, plural = false): string {
  const noun = provider === "gitlab" ? "Merge request" : "Pull request";
  return plural ? `${noun}s` : noun;
}

const CHECKS ={ passing: "checks passing", failing: "checks failing", pending: "checks running" } as const;
const REVIEWS = { approved: "approved", changes: "changes requested", required: "review required" } as const;

/** "Open · checks passing · approved": the one-line status a tooltip or row subtitle reads. */
export function describePullRequest(pull: PullRequest): string {
  const parts: string[] = [PR_STATE[pull.state].label];
  if (pull.checks !== "none") parts.push(CHECKS[pull.checks]);
  if (pull.review !== null) parts.push(REVIEWS[pull.review]);
  return parts.join(" · ");
}
