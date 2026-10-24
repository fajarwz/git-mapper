import type { Repository } from "../types";
import { PlusIcon, RepoIcon } from "./icons";

interface RepoTabsProps {
  repos: Repository[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function RepoTabs({ repos, activeId, onSelect }: RepoTabsProps) {
  return (
    <div
      className="flex items-center gap-1 overflow-x-auto overflow-y-hidden"
      role="tablist"
      aria-label="Open repositories"
    >
      {repos.map((repo) => {
        const active = repo.id === activeId;

        return (
          <button
            key={repo.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active}
            title={repo.path}
            onClick={() => onSelect(repo.id)}
            className="inline-flex h-8 shrink-0 cursor-default items-center gap-2 rounded-full border border-transparent px-3 text-left text-ink-soft transition-colors hover:bg-hover-glass focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent data-[active=true]:border-hairline data-[active=true]:bg-glass-strong data-[active=true]:text-ink data-[active=true]:soft-shadow"
          >
            <RepoIcon />
            <span className="text-[13px] font-semibold">{repo.name}</span>
            <span className="font-mono text-[11px] text-ink-dim">{repo.branch}</span>
          </button>
        );
      })}

      <button
        type="button"
        className="ml-1 grid h-8 w-8 shrink-0 cursor-default place-items-center rounded-full border border-dashed border-rule text-ink-dim opacity-70"
        title="Opening a repository is not part of this UI-only build"
        aria-label="Open repository"
        disabled
      >
        <PlusIcon />
      </button>
    </div>
  );
}
