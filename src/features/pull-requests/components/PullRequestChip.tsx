import type { CSSProperties } from "react";
import { openExternal } from "../../../shared/lib/external";
import { pullRequestLabel } from "../lib/pullRequestTone";
import type { PullChipData } from "../lib/pullRequests";
import { PullRequestIcon } from "../../../shared/components/icons";
import { PullRequestStateIcon } from "./PullRequestStateIcon";

/**
 * The #number capsule: a surface-coloured pill with the state glyph, so it reads on any lane hue
 * and on plain rows alike. A span, not a button: it sits inside the row's own button, so clicks
 * stop here — opening the request neither selects the row nor (double-click) checks a branch out.
 * `className` carries where it sits (inside a ref pill, or on a row).
 */
export function PullRequestChip({
  chip,
  className = "",
  style,
}: {
  chip: PullChipData;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      role="link"
      data-pr-badge
      aria-label={chip.ariaLabel}
      title={chip.tooltip}
      onClick={(event) => {
        event.stopPropagation();
        openExternal(chip.url);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      style={style}
      className={`inline-flex h-4 shrink-0 cursor-pointer items-center gap-0.5 rounded-full bg-surface pl-1 pr-1.5 font-mono text-[10px] font-semibold leading-none text-ink ring-1 transition-shadow hover:ring-primary-ink/50 ${className}`}
    >
      {chip.state ? (
        <PullRequestStateIcon state={chip.state} size={10} />
      ) : (
        <span className="inline-grid shrink-0 place-items-center text-ink-dim">
          <PullRequestIcon size={10} />
        </span>
      )}
      {pullRequestLabel(chip)}
    </span>
  );
}
