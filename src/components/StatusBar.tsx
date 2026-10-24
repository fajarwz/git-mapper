import type { Commit, Repository } from "../types";

interface StatusBarProps {
  repo: Repository | null;
  commit: Commit | null;
  repoCount: number;
}

export function StatusBar({ repo, commit, repoCount }: StatusBarProps) {
  return (
    <footer className="flex h-6 items-center justify-between gap-4 overflow-hidden whitespace-nowrap px-1.5 text-[11.5px] text-ink-dim">
      <span>
        {repoCount === 0
          ? "Open a Git repository to start"
          : `${repoCount} repositor${repoCount === 1 ? "y" : "ies"} · ${repo?.commits.length ?? 0} commits · ${repo?.branch ?? ""}`}
      </span>
      <span className="flex min-w-0 items-center gap-2 overflow-hidden">
        <span className="truncate font-mono font-medium text-ink-soft">{commit?.hash ?? ""}</span>
      </span>
    </footer>
  );
}
