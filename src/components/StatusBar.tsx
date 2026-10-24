import type { Commit, Repository } from "../types";

interface StatusBarProps {
  repo: Repository;
  commit: Commit;
  repoCount: number;
}

export function StatusBar({ repo, commit, repoCount }: StatusBarProps) {
  return (
    <footer className="flex h-6 items-center justify-between gap-4 overflow-hidden whitespace-nowrap px-1.5 text-[11.5px] text-ink-dim">
      <span>
        {repoCount} repositories · {repo.commits.length} commits · {repo.branch}
      </span>
      <span className="flex min-w-0 items-center gap-2 overflow-hidden">
        <span className="font-mono font-medium text-ink-soft">{commit.hash}</span>
        <span className="text-ink-dim/50" aria-hidden="true">
          |
        </span>
        UI shell with mock history — no Git operations
      </span>
    </footer>
  );
}
