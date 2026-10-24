import type { Repository } from "../types";
import { CloseIcon, PlusIcon, RepoIcon } from "./icons";

interface RepoTabsProps {
  repos: Repository[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
  adding: boolean;
}

export function RepoTabs({ repos, activeId, onSelect, onAdd, onClose, adding }: RepoTabsProps) {
  return (
    <div
      className="flex items-center gap-1 overflow-x-auto overflow-y-hidden"
      role="tablist"
      aria-label="Open repositories"
    >
      {repos.map((repo) => {
        const active = repo.id === activeId;
        return (
          <div
            key={repo.id}
            data-active={active}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-transparent pl-3 text-left text-ink-soft transition-colors hover:bg-hover-glass focus-within:ring-2 focus-within:ring-primary/70 focus-within:ring-offset-2 focus-within:ring-offset-transparent data-[active=true]:border-hairline data-[active=true]:bg-glass-strong data-[active=true]:text-ink data-[active=true]:soft-shadow"
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              title={repo.path}
              onClick={() => onSelect(repo.id)}
              className="flex cursor-default items-center gap-2 bg-transparent p-0 text-left"
            >
              <RepoIcon />
              <span className="text-[13px] font-semibold">{repo.name}</span>
              <span className="font-mono text-[11px] text-ink-dim">{repo.branch}</span>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onClose(repo.id);
              }}
              aria-label={`Close ${repo.name}`}
              title={`Close ${repo.name}`}
              className="grid h-5 w-5 shrink-0 cursor-default place-items-center rounded-full text-ink-dim hover:bg-hover-glass hover:text-ink"
            >
              <CloseIcon size={9} />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAdd}
        disabled={adding}
        aria-label="Open repository"
        title="Open a repository folder"
        className="ml-1 grid h-8 w-8 shrink-0 cursor-default place-items-center rounded-full border border-dashed border-rule text-ink-dim hover:bg-hover-glass hover:text-ink disabled:opacity-60"
      >
        <PlusIcon />
      </button>
    </div>
  );
}
