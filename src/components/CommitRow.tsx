import { memo } from "react";
import type { Commit, CommitRef } from "../types";
import { formatAbsoluteDate } from "../lib/format";
import { branchColor } from "../lib/graphGeometry";
import { COMMIT_ROW_GRID } from "../lib/tableLayout";
import { RefPill } from "./RefPill";

interface CommitRowProps {
  commit: Commit;
  selected: boolean;
  /** Just arrived (or its refs changed) in the last refresh: flash the row once. */
  fresh?: boolean;
  onSelect: (hash: string) => void;
  onCheckoutBranch?: (branch: string) => void;
  /** Right-click on the row body: the menu targets the commit and its most relevant ref. */
  onContextMenu?: (commit: Commit, x: number, y: number) => void;
  /** Right-click on a pill: the menu targets that exact ref. */
  onRefContextMenu?: (commit: Commit, ref: CommitRef, x: number, y: number) => void;
}

export const CommitRow = memo(function CommitRow({
  commit,
  selected,
  fresh = false,
  onSelect,
  onCheckoutBranch,
  onContextMenu,
  onRefContextMenu,
}: CommitRowProps) {
  // The checked-out branch's tip commit reads bold across the whole row.
  const onHead = commit.refs.some((ref) => ref.isCurrent);
  const weight = onHead ? "font-bold" : "";
  const metaWeight = onHead ? "font-semibold" : "";

  return (
    <button
      type="button"
      data-commit-row
      className={`group grid h-8 w-full cursor-default items-center gap-2 border-b border-rule/70 bg-transparent p-0 text-left transition-colors hover:bg-hover-glass focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 data-[selected=true]:bg-selected-glass data-[selected=true]:hover:bg-selected-glass ${COMMIT_ROW_GRID} ${fresh ? "row-flash" : ""}`}
      data-selected={selected}
      aria-pressed={selected}
      onClick={() => onSelect(commit.hash)}
      onContextMenu={
        onContextMenu
          ? (event) => {
              event.preventDefault();
              onContextMenu(commit, event.clientX, event.clientY);
            }
          : undefined
      }
    >
      <span className="flex min-w-0 items-center gap-2 overflow-hidden">
        <span
          aria-hidden="true"
          className="h-5 w-0.5 shrink-0"
          style={{ backgroundColor: branchColor(commit.branchColor) }}
        />
        <span className={`truncate text-[13px] text-ink ${weight}`}>
          {commit.subject}
        </span>
        {commit.refs.map((ref) => (
          <RefPill
            key={`${ref.type}:${ref.name}`}
            ref={ref}
            color={commit.branchColor}
            onCheckout={onCheckoutBranch}
            onContextMenu={onRefContextMenu ? (pill, x, y) => onRefContextMenu(commit, pill, x, y) : undefined}
          />
        ))}
      </span>

      <span className={`truncate text-[12px] text-ink-dim ${metaWeight}`}>{commit.author}</span>

      <time
        className={`truncate text-[12px] text-ink-dim ${metaWeight}`}
        dateTime={commit.date}
      >
        {formatAbsoluteDate(commit.date)}
      </time>

      <span className={`font-mono text-[11px] text-ink-dim ${metaWeight}`}>
        {commit.hash.slice(0, 8)}
      </span>

      <span aria-hidden="true" />
    </button>
  );
});
