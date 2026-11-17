import { PullRequestState } from "../types";
import { PR_STATE } from "../lib/pullRequestTone";
import { PullRequestClosedIcon, PullRequestDraftIcon, PullRequestIcon, PullRequestMergedIcon } from "./icons";

const GLYPHS = {
  [PullRequestState.Open]: PullRequestIcon,
  [PullRequestState.Draft]: PullRequestDraftIcon,
  [PullRequestState.Merged]: PullRequestMergedIcon,
  [PullRequestState.Closed]: PullRequestClosedIcon,
} as const;

/** The state as a drawn glyph in its tone: shape and colour both say it, never colour alone. */
export function PullRequestStateIcon({ state, size = 12 }: { state: PullRequestState; size?: number }) {
  const Glyph = GLYPHS[state];
  return (
    <span className={`inline-grid shrink-0 place-items-center ${PR_STATE[state].text}`}>
      <Glyph size={size} />
    </span>
  );
}
