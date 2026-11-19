import { Fragment, memo, type ReactNode } from "react";
import type { Commit, CommitRef, PullRequest } from "../../../types";
import { pullRequestForRef } from "../../pull-requests/lib/pullRequests";
import { formatAbsoluteDate } from "../../../shared/lib/format";
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
import { PullRequestChip } from "../../pull-requests/components/PullRequestChip";
import type { PullChipData } from "../../pull-requests/lib/pullRequests";
import { Avatar } from "./Avatar";
import { Marked } from "./Marked";

interface CommitRowProps {
  commit: Commit;
  selected: boolean;
  /** Just arrived (or its refs changed) in the last refresh: flash the row once. */
  fresh?: boolean;
  /** A find is running and this row is not a match: it recedes, the graph beside it stays intact. */
  dim?: boolean;
  /** The match the find bar is on right now. */
  current?: boolean;
  /** The find's tokens, on a matching row only: the text they hit is painted. Keep it stable for the memo. */
  terms?: string[];
  /** The initials avatar sits left of the username; the settings toggle owns its visibility. */
  showAvatar?: boolean;
  /** Which optional columns are shown; keep the object stable so the memo holds. */
  columns?: ColumnVisibility;
  /** Column order, shared with the header; stable identity like `columns`. */
  order?: ColumnId[];
  /** Branch name → PR; keep the map stable (the hook memoizes it) so the memo holds. */
  pullsByBranch?: Map<string, PullRequest>;
  /** The request a commit came from (a squash merge's own commit, or the one its message names). */
  commitChip?: (commit: Commit) => PullChipData | null;
  onSelect: (hash: string) => void;
  onCheckoutBranch?: (branch: string) => void;
  /** Right-click on the row body: the menu targets the commit and its most relevant ref. */
  onContextMenu?: (commit: Commit, x: number, y: number) => void;
  /** Right-click on a pill: the menu targets that exact ref. */
  onRefContextMenu?: (commit: Commit, ref: CommitRef, x: number, y: number) => void;
}

function CommitChip({ commit, commitChip }: { commit: Commit; commitChip?: (commit: Commit) => PullChipData | null }) {
  const chip = commitChip?.(commit) ?? null;
  return chip && <PullRequestChip chip={chip} className="ring-hairline" />;
}

export const CommitRow = memo(function CommitRow({
  commit,
  selected,
  fresh = false,
  dim = false,
  current = false,
  terms,
  showAvatar = false,
  columns = DEFAULT_COLUMNS,
  order = DEFAULT_ORDER,
  pullsByBranch,
  commitChip,
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
            <Marked text={commit.subject} terms={terms} />
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
                pullRequest={pullsByBranch && pullRequestForRef(ref, pullsByBranch)}
                color={commit.branchColor}
                onCheckout={onCheckoutBranch}
                onContextMenu={onRefContextMenu ? (pill, x, y) => onRefContextMenu(commit, pill, x, y) : undefined}
              />
            ))
          )}
          {!isWorktreeRow && commit.stashIndex === undefined && (
            <CommitChip commit={commit} commitChip={commitChip} />
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
              <span className="truncate"><Marked text={commit.author} terms={terms} /></span>
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
          {isWorktreeRow ? "—" : <Marked text={commit.hash.slice(0, 8)} terms={terms} />}
        </span>
      </Fragment>
    ),
  };

  return (
    <button
      type="button"
      data-commit-row
      data-commit-hash={commit.hash}
      data-dim={dim ? "true" : undefined}
      data-find-current={current ? "true" : undefined}
      className={`group grid h-8 w-full items-center gap-2 border-b border-rule/70 bg-transparent p-0 text-left transition-[background-color,opacity] hover:bg-hover-glass focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 data-[selected=true]:bg-selected-glass data-[selected=true]:hover:bg-selected-glass data-[dim=true]:opacity-15 data-[dim=true]:hover:opacity-100 data-[find-current=true]:bg-primary/25 data-[find-current=true]:shadow-[inset_3px_0_0_var(--color-primary)] ${COMMIT_ROW_GRID} ${fresh ? "row-flash" : ""}`}
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
