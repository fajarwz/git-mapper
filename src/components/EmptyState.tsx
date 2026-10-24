import type { Repository } from "../types";
import { GLASS_CONTROL, PANEL } from "../lib/ui";
import { PlusIcon } from "./icons";

interface EmptyStateProps {
  onOpen: () => void;
  error: string | null;
  loading: boolean;
  repos: Repository[];
}

export function EmptyState({ onOpen, error, loading, repos }: EmptyStateProps) {
  return (
    <div className="grid h-full min-h-0 place-items-center">
      <div
        className={`${PANEL} flex w-full max-w-md flex-col items-center gap-4 px-8 py-10 text-center`}
      >
        <h2 className="m-0 text-[16px] font-bold text-ink">
          {repos.length === 0 ? "Open a Git repository" : "Could not open that folder"}
          {""}
        </h2>
        <p className="m-0 text-[13px] leading-relaxed text-ink-dim">
          {repos.length === 0
            ? "Pick a folder with a .git directory and Git Mapper shows its history, graph and diffs."
            : "That folder is not a Git repository or git could not read it."}
        </p>
        <button
          type="button"
          onClick={onOpen}
          disabled={loading}
          className={`${GLASS_CONTROL} inline-flex h-10 cursor-default items-center gap-2 px-4 text-[13px] font-semibold text-ink hover:bg-sheet-strong disabled:opacity-60`}
        >
          <PlusIcon />
          {loading ? "Opening…" : "Open folder"}
        </button>
        {error && <p className="m-0 text-[12px] break-words text-danger-ink">{error}</p>}
      </div>
    </div>
  );
}
