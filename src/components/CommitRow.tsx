import { Fragment, memo, type ReactNode } from "react";
import type { Commit, CommitRef } from "../types";
import { formatAbsoluteDate } from "../lib/format";
import { UNCOMMITTED_COLOR, branchColor } from "../lib/graphGeometry";
import {
  COMMIT_ROW_GRID,
  DEFAULT_COLUMNS,
  DEFAULT_ORDER,
  shownColumns,
  type ColumnId,
  type ColumnVisibility,
} from "../lib/tableLayout";
import { RefPill } from "./RefPill";
import { Avatar } from "./Avatar";

interface CommitRowProps {
  commit: Commit;
  selected: boolean;
  /** Just arrived (or its refs changed) in the last refresh: flash the row once. */
  fresh?: boolean;
  /** The initials avatar sits left of the username; the settings toggle owns its visibility. */
  showAvatar?: boolean;
  /** Which optional columns are shown; keep the object stable so the memo holds. */
  columns?: ColumnVisibility;
  /** Column order, shared with the header; stable identity like `columns`. */
  order?: ColumnId[];
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
  showAvatar = false,
  columns = DEFAULT_COLUMNS,
  order = DEFAULT_ORDER,
  onSelect,
  onCheckoutBranch,
  onContextMenu,
  onRefContextMenu,
}: CommitRowProps) {
  // The checked-out branch's tip commit reads bold across the whole row — and so does the
  // working-copy row: two weights only (normal rows at 400, "now" rows at 900). The amber
  // pill tells which "now" is which.
  const onHead = commit.refs.some((ref) => ref.isCurrent);
  const isWorktreeRow = commit.changedCount !== undefined;
  const weight = onHead || isWorktreeRow ? "font-black" : "";

  const cells: Record<ColumnId, ReactNode> = {
    message: (
      <Fragment key="message">
        <span className="flex min-w-0 items-center gap-2 overflow-hidden">
          <span
            aria-hidden="true"
            className="h-5 w-0.5 shrink-0"
            style={{ backgroundColor: isWorktreeRow ? UNCOMMITTED_COLOR : branchColor(commit.branchColor) }}
          />
          <span className={`truncate text-[13px] text-ink ${weight}`}>
            {commit.subject}
          </span>
          {isWorktreeRow ? (
            <span
              title={`${commit.changedCount} changed files in the working tree`}
              className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full border-[1.5px] px-2 text-[10.5px] leading-none text-warning-ink"
              style={{ borderColor: "var(--color-warning)" }}
            >
              {commit.changedCount} {commit.changedCount === 1 ? "file" : "files"}
            </span>
          ) : (
            commit.refs.map((ref) => (
              <RefPill
                key={`${ref.type}:${ref.name}`}
                ref={ref}
                color={commit.branchColor}
                onCheckout={onCheckoutBranch}
                onContextMenu={onRefContextMenu ? (pill, x, y) => onRefContextMenu(commit, pill, x, y) : undefined}
              />
            ))
          )}
        </span>
      </Fragment>
    ),
    author: (
      <Fragment key="author">
        <span className={`flex min-w-0 items-center gap-1.5 text-[12px] text-ink-dim ${weight}`}>
          {isWorktreeRow ? (
            <span>—</span>
          ) : (
            <>
              {showAvatar && <Avatar name={commit.author} email={commit.authorEmail} photos />}
              <span className="truncate">{commit.author}</span>
            </>
          )}
        </span>
      </Fragment>
    ),
    date: (
      <Fragment key="date">
        <time
          className={`truncate text-[12px] text-ink-dim ${weight}`}
          dateTime={commit.date}
        >
          {formatAbsoluteDate(commit.date)}
        </time>
      </Fragment>
    ),
    hash: (
      <Fragment key="hash">
        <span className={`font-mono text-[11px] text-ink-dim ${weight}`}>
          {isWorktreeRow ? "—" : commit.hash.slice(0, 8)}
        </span>
      </Fragment>
    ),
  };

  return (
    <button
      type="button"
      data-commit-row
      className={`group grid h-8 w-full items-center gap-2 border-b border-rule/70 bg-transparent p-0 text-left transition-colors hover:bg-hover-glass focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 data-[selected=true]:bg-selected-glass data-[selected=true]:hover:bg-selected-glass ${COMMIT_ROW_GRID} ${fresh ? "row-flash" : ""}`}
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
      {shownColumns(columns, order).map((id) => cells[id])}

      <span aria-hidden="true" />
    </button>
  );
});
