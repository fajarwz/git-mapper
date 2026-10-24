import type { Commit } from "../types";
import { formatAbsoluteDate } from "../lib/format";
import { COMMIT_ROW_GRID } from "../lib/tableLayout";
import { RefPill } from "./RefPill";

interface CommitRowProps {
  commit: Commit;
  selected: boolean;
  onSelect: (hash: string) => void;
}

export function CommitRow({ commit, selected, onSelect }: CommitRowProps) {
  return (
    <button
      type="button"
      data-commit-row
      className={`group grid h-11 w-full cursor-default items-center gap-2 border-b border-rule/70 bg-transparent p-0 text-left transition-colors hover:bg-hover-glass focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 data-[selected=true]:bg-selected-glass data-[selected=true]:shadow-[inset_3px_0_0_var(--color-primary)] data-[selected=true]:hover:bg-selected-glass ${COMMIT_ROW_GRID}`}
      data-selected={selected}
      aria-pressed={selected}
      onClick={() => onSelect(commit.hash)}
    >
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <span className="truncate text-[13.5px] text-ink group-data-[selected=true]:font-semibold">
          {commit.subject}
        </span>
        {commit.refs.map((ref) => (
          <RefPill key={`${ref.type}:${ref.name}`} ref={ref} />
        ))}
      </span>

      <span className="truncate text-[12.5px] text-ink-dim">{commit.author}</span>

      <time
        className="truncate text-[12.5px] text-ink-dim"
        dateTime={commit.date}
        title={formatAbsoluteDate(commit.date)}
      >
        {commit.relativeDate}
      </time>

      <span className="truncate font-mono text-[11.5px] text-ink-dim">{commit.hash}</span>

      <span aria-hidden="true" />
    </button>
  );
}
