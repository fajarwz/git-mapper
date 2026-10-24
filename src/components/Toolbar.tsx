import type { Repository } from "../types";
import { GLASS_CONTROL, PANEL } from "../lib/ui";
import { BranchIcon, ChevronDownIcon, SettingsIcon } from "./icons";

interface ToolbarProps {
  repo: Repository | null;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onOpenSettings: () => void;
}

function BrandMark() {
  return (
    <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 ring-1 ring-inset ring-hairline">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d="M4.5 4.5v9" stroke="#6e56cf" strokeWidth="1.7" strokeLinecap="round" />
        <path
          d="M13.5 4.5v3c0 3.2-4.2 2.6-7.6 3.6"
          stroke="#57536e"
          strokeWidth="1.7"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="4.5" cy="4.5" r="2.1" fill="#6e56cf" />
        <circle cx="13.5" cy="4.5" r="2.1" fill="#57536e" />
        <circle cx="4.5" cy="13.5" r="1.6" fill="#ffffff" stroke="#6e56cf" strokeWidth="1.4" />
      </svg>
    </span>
  );
}

export function Toolbar({ repo, detailsOpen, onToggleDetails, onOpenSettings }: ToolbarProps) {
  return (
    <header className={`${PANEL} flex items-center gap-3 px-3`}>
      <div className="flex shrink-0 items-center gap-2.5">
        <BrandMark />
        <span className="text-[15px] font-bold tracking-tight text-ink">Git Mapper</span>
      </div>

      <span
        className="min-w-0 flex-1 truncate rounded-full border border-hairline bg-sheet px-3 py-1.5 font-mono text-[11.5px] text-ink-dim"
        title={repo?.path}
      >
        {repo?.path ?? "No repository open"}
      </span>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open settings"
          title="Settings"
          className={`${GLASS_CONTROL} grid h-8 w-8 cursor-default place-items-center text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent`}
        >
          <SettingsIcon />
        </button>

        <button
          type="button"
          onClick={onToggleDetails}
          aria-pressed={detailsOpen}
          title={detailsOpen ? "Hide the commit details panel" : "Show the commit details panel"}
          className={`${GLASS_CONTROL} inline-flex h-8 cursor-default items-center gap-1 px-3 text-[12px] font-semibold text-ink-soft hover:bg-sheet-strong focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent`}
        >
          <ChevronDownIcon
            className={`transition-transform duration-150 ${detailsOpen ? "" : "rotate-180"}`}
          />
          Details
        </button>

        {repo && (
          <>
            <span className="inline-flex items-center gap-[5px] rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary-ink">
              <BranchIcon />
              {repo.branch}
            </span>
            {repo.ahead > 0 && (
              <span className="font-mono text-[11px] font-semibold text-success-ink">↑{repo.ahead}</span>
            )}
            {repo.behind > 0 && (
              <span className="font-mono text-[11px] font-semibold text-warning-ink">↓{repo.behind}</span>
            )}
          </>
        )}
      </div>
    </header>
  );
}
