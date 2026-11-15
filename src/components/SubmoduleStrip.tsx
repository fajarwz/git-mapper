import type { Repository, Submodule } from "../types";
import { RepoIcon, SubmoduleIcon } from "./icons";

const PILL =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-transparent bg-glass-soft px-2.5 text-[12px] text-ink-soft backdrop-blur-md transition-[background-color,border-color,color,box-shadow,opacity] hover:bg-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60 data-[active=true]:border-hairline data-[active=true]:bg-glass-strong data-[active=true]:text-ink data-[active=true]:soft-shadow aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-glass-soft";

function markerFor(sub: Submodule, loaded: Repository | undefined): string | null {
  if (sub.state === "conflict") return "Merge conflict on the submodule pointer";
  if (sub.state === "moved") return "Checked out at a different commit than this repository records";
  if (loaded && loaded.changed > 0) return "Uncommitted changes";
  return null;
}

/**
 * The repo's own row under the title bar: the repository itself first, then each of its
 * submodules. The title bar chooses WHICH repository is open; this strip chooses which of its
 * repositories you are looking at, so it only exists when there are submodules to choose.
 */
export function SubmoduleStrip({
  root,
  repos,
  activeId,
  openingId,
  onSelect,
}: {
  root: Repository;
  /** Every open repo, to read the state of submodules that are already loaded. */
  repos: Repository[];
  activeId: string | null;
  /** The submodule being read right now; its pill waits instead of racing a second click. */
  openingId: string | null;
  onSelect: (id: string, submodule?: Submodule) => void;
}) {
  const subs = root.submodules ?? [];
  return (
    <div
      role="tablist"
      aria-label="Repository and submodules"
      data-submodule-strip
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-2.5 pb-0.5 pt-1"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeId === root.id}
        data-active={activeId === root.id}
        title={root.path}
        onClick={() => onSelect(root.id)}
        className={PILL}
      >
        <RepoIcon size={13} />
        <span className="max-w-48 truncate font-semibold">{root.name}</span>
        {root.changed > 0 && (
          <span
            role="img"
            aria-label="Uncommitted changes"
            title="Uncommitted changes"
            className="size-1.5 shrink-0 rounded-full bg-warning"
          />
        )}
      </button>
      {subs.map((sub) => {
        const loaded = repos.find((item) => item.id === sub.fullPath);
        const marker = markerFor(sub, loaded);
        const uninitialized = sub.state === "uninitialized";
        return (
          <button
            key={sub.fullPath}
            type="button"
            role="tab"
            aria-selected={activeId === sub.fullPath}
            aria-disabled={uninitialized || openingId === sub.fullPath || undefined}
            data-active={activeId === sub.fullPath}
            data-submodule-tab={sub.path}
            title={uninitialized ? `${sub.path} — not cloned here` : `${root.name} / ${sub.path}`}
            onClick={() => {
              if (!uninitialized && openingId === null) onSelect(sub.fullPath, sub);
            }}
            className={PILL}
          >
            <SubmoduleIcon size={13} />
            <span className="max-w-48 truncate">{sub.name}</span>
            {marker && (
              <span
                role="img"
                aria-label={marker}
                title={marker}
                className="size-1.5 shrink-0 rounded-full bg-warning"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
