import { useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { BranchIcon, CloseIcon, MinusIcon, PlusIcon, TrashIcon } from "./icons";
import { STATUS_TONES, fileDirTone, fileNameTone, fileTitle, statusLetter } from "../lib/format";
import type { WorktreeFile } from "../lib/staging";
import { PANEL } from "../lib/ui";

interface StagePanelProps {
  branch: string;
  /** The worktree rows, owned by and reloaded from App (the badge counts them). */
  files: WorktreeFile[];
  /** True while a git write is in flight: every row action and the commit button wait. */
  busy?: boolean;
  /** The merge resolution slice's state: MERGE_HEAD present, its unmerged paths. */
  merging?: boolean;
  conflicts?: string[];
  /** Takes one side of every given unmerged path from the index stages and stages it. */
  onResolve: (paths: string[], side: "ours" | "theirs") => void;
  /** Abandons the whole merge; the panel asks first through its danger confirm. */
  onAbortMerge: () => void;
  /** Commits the fully resolved merge with git's own prepared message. */
  onCompleteMerge: () => void;
  /** A conflict row click: App reads both sides into the details panel. */
  onSelectConflict?: (path: string) => void;
  /** `git add --` these paths (a worktree row's stage, or the Stage-all sweep). */
  onStage: (paths: string[]) => void;
  /** `git restore --staged --` these paths (a staged row's unstage, or the Unstage-all sweep). */
  onUnstage: (paths: string[]) => void;
  /** Per-path discard; the wire classifies from a fresh status (untracked, staged, tracked). */
  onDiscard: (paths: string[]) => void;
  /** Discard every row: tracked changes reset, untracked files are deleted from disk. */
  onDiscardAll: () => void;
  /** Commits the index; success docks the drawer from App's side. */
  onCommit: (message: string) => void;
  /** A row click is a request to read that file: App selects it in the details diff. */
  onSelectRow?: (file: WorktreeFile) => void;
  /**
   * The row the diff pane is showing (path + side). App owns it, so the highlight follows the
   * pane — including its fallback to the other side. Unset: the panel tracks its own clicks.
   */
  selection?: { path: string; staged: boolean } | null;
  /** Docks the drawer: the × in the header, Esc while the panel holds focus, the badge state. */
  onClose: () => void;
}

/** Rail width knobs: a pin outlives layout changes, null = the tuned default. */
export const DEFAULT_STAGE_WIDTH = 280;
export const MIN_STAGE_WIDTH = 220;
export const MAX_STAGE_WIDTH = 480;

function splitPath(path: string): { dir: string; base: string } {
  const cut = path.lastIndexOf("/");
  if (cut === -1) return { dir: "", base: path };
  return { dir: path.slice(0, cut + 1), base: path.slice(cut + 1) };
}

const SECTION_HEADER_CLASS =
  "sticky top-0 z-10 flex items-center gap-2 border-b border-hairline bg-sheet-band px-3.5 py-1.5 text-[11px] font-semibold text-ink-dim";

const SECTION_ACTION_CLASS =
  "ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold text-ink-dim transition-colors hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60 disabled:invisible";

/** One changed file: status cube, path, counts, and the row's stage/unstage/discard actions. */
function ItemRow({
  file,
  selected,
  onSelect,
  onSelectRow,
  onStage,
  onUnstage,
  onDiscard,
}: {
  file: WorktreeFile;
  selected: boolean;
  /** Gets the row's key, not its path: a half-staged file is two rows and only one is selected. */
  onSelect: (key: string) => void;
  /** Row click handler from App: selects the file for the details-diff pane. */
  onSelectRow?: (file: WorktreeFile) => void;
  /** Worktree rows only: stamps the file into the index. */
  onStage?: () => void;
  /** Index rows only: drops the index copy (`git restore --staged`). */
  onUnstage?: () => void;
  onDiscard: () => void;
}) {
  const { dir, base } = splitPath(file.path);
  const label = fileTitle(file);

  return (
    <div
      data-staging-item
      data-staged={file.staged}
      data-selected={selected}
      className="grid h-7 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 pl-3.5 pr-2 transition-colors hover:bg-hover-glass data-[selected=true]:bg-selected-glass data-[selected=true]:hover:bg-selected-glass data-[selected=true]:shadow-[inset_3px_0_0_var(--color-primary)]"
    >
      <button
        type="button"
        className="flex h-7 min-w-0 items-center gap-2 bg-transparent text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
        onClick={() => {
          onSelect(file.key);
          onSelectRow?.(file);
        }}
      >
        <span
          className={`grid size-4.5 shrink-0 place-items-center rounded-[4px] text-center font-mono text-[10.5px] font-bold ${STATUS_TONES[file.status]}`}
          aria-label={file.status}
          title={label}
        >
          {statusLetter(file.status)}
        </span>
        <span className="truncate text-[12px]" title={label}>
          {file.oldPath ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-ink-dim">{file.oldPath}</span>
              <span className="shrink-0 text-ink-dim">→</span>
              <span className="truncate">
                <span className="text-ink-dim">{dir}</span>
                <span className={fileNameTone(file.status)}>{base}</span>
              </span>
            </span>
          ) : (
            <>
              {dir !== "" && <span className={fileDirTone(file.status)}>{dir}</span>}
              <span className={fileNameTone(file.status)}>{base}</span>
            </>
          )}
        </span>
        <span className="ml-auto flex shrink-0 gap-1.5 font-mono text-[10.5px]">
          {file.additions > 0 && <span className="text-success-ink">+{file.additions}</span>}
          {file.deletions > 0 && <span className="text-danger-ink">−{file.deletions}</span>}
        </span>
      </button>

      <span className="flex shrink-0 items-center gap-0.5">
        {file.staged ? (
          <RowAction label={`Unstage ${base}`} onClick={onUnstage}>
            <MinusIcon size={11} />
          </RowAction>
        ) : (
          <>
            <RowAction label={`Stage ${base}`} onClick={onStage}>
              <PlusIcon size={11} />
            </RowAction>
            <RowAction
              label={file.untracked ? `Delete untracked ${base}` : `Discard changes in ${base}`}
              onClick={onDiscard}
              hoverTone="hover:bg-danger/15 hover:text-danger-ink"
            >
              <TrashIcon size={11} />
            </RowAction>
          </>
        )}
      </span>
    </div>
  );
}

/**
 * A faint-at-rest icon action on the row's right edge: visible without hover (no hover-only
 * discovery), strengthened on hover and focus. Discard's hover tone is danger — it is the
 * destructive one of the three.
 */
function RowAction({
  label,
  onClick,
  children,
  hoverTone = "hover:bg-hover-glass hover:text-ink",
}: {
  label: string;
  /** Absent = the action does not exist in that section (staged rows have no ×, and so on). */
  onClick?: () => void;
  children: ReactNode;
  hoverTone?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={onClick === undefined}
      className={`grid size-5 place-items-center rounded-full text-ink-dim opacity-70 transition-[opacity,color,background-color] hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/60 ${hoverTone}`}
    >
      {children}
    </button>
  );
}

interface SectionProps {
  title: string;
  count: number;
  empty: string;
  action?: { label: string; title: string; onClick: () => void };
  disabled?: boolean;
  children: ReactNode;
}

/** Stacked subsection of the panel: sticky header with its count chip and bulk action. */
function Section({ title, count, empty, action, disabled, children }: SectionProps) {
  return (
    <section aria-label={`${title} files`}>
      <div className={SECTION_HEADER_CLASS}>
        <span className="shrink-0">{title}</span>
        <span className="font-mono text-[10.5px] font-normal tracking-normal">{count}</span>
        {action && (
          <button
            type="button"
            className={SECTION_ACTION_CLASS}
            title={action.title}
            onClick={action.onClick}
            disabled={disabled}
          >
            {action.label}
          </button>
        )}
      </div>
      {count === 0 ? (
        <p className="m-0 px-3.5 py-2 text-[12px] text-ink-dim">{empty}</p>
      ) : (
        children
      )}
    </section>
  );
}

export function StagePanel({
  branch,
  files,
  busy = false,
  merging = false,
  conflicts,
  onResolve,
  onAbortMerge,
  onCompleteMerge,
  onSelectConflict,
  onStage,
  onUnstage,
  onDiscard,
  onDiscardAll,
  onCommit,
  onSelectRow,
  selection,
  onClose,
}: StagePanelProps) {
  const [message, setMessage] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const isSelected = (file: WorktreeFile) =>
    selection === undefined
      ? file.key === selectedPath
      : selection !== null && selection.path === file.path && selection.staged === file.staged;
  const [pendingDiscard, setPendingDiscard] = useState<"all" | WorktreeFile | null>(null);
  const [pendingAbort, setPendingAbort] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  // Esc docks the drawer, but only while the user is actually working in it (focus inside the
  // rail) — a stray Esc elsewhere keeps its own meanings (clear the search, close the menu).
  // The discard dialog keeps its own Esc; the guard keeps this from double-firing.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || pendingDiscard !== null) return;
      // The dispatch target is window when no element holds focus — no Node, no "inside".
      if (!(event.target instanceof Node) || !sectionRef.current?.contains(event.target)) return;
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [pendingDiscard, onClose]);

  const staged = files.filter((file) => file.staged);
  const unstaged = files.filter((file) => !file.staged);
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  const confirmDiscard = () => {
    const target = pendingDiscard;
    setPendingDiscard(null);
    if (target === "all") onDiscardAll();
    else if (target) onDiscard([target.path]);
  };

  const confirmAbort = () => {
    setPendingAbort(false);
    onAbortMerge();
  };

  const handleCommit = () => {
    const trimmed = message.trim();
    if (staged.length === 0 || trimmed === "" ) return;
    onCommit(trimmed);
  };

  return (
    <section
      ref={sectionRef}
      data-stage-rail
      className={`${PANEL} relative flex size-full flex-col overflow-hidden`}
      aria-label="Uncommitted changes"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-hairline bg-sheet-band pl-3.5 pr-1.5 text-[11.5px] font-semibold text-ink-dim">
        <span className="truncate">Uncommitted changes</span>
        <span className="ml-auto flex shrink-0 gap-2 font-mono text-[10.5px] tracking-normal">
          {additions > 0 && <span className="text-success-ink">+{additions}</span>}
          {deletions > 0 && <span className="text-danger-ink">−{deletions}</span>}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close uncommitted-changes rail"
          title="Hide uncommitted changes"
          className="grid size-7 shrink-0 place-items-center rounded-full text-ink-dim transition-colors hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <CloseIcon size={10} />
        </button>
      </header>

      <div className="flex h-6.5 shrink-0 items-center gap-1.5 border-b border-rule px-3.5 text-[10.5px] text-ink-dim">
        <BranchIcon size={11} />
        <span className="truncate font-mono" title={`Staging onto ${branch}`}>
          {branch}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {merging && (
          <Section
            title="Conflicts"
            count={(conflicts ?? []).length}
            empty="No unmerged paths — the merge is ready to complete."
            action={{ label: "Abort merge…", title: "Discard the merge and its conflicts", onClick: () => setPendingAbort(true) }}
          >
            {(conflicts ?? []).map((path) => {
              const base = splitPath(path).base;
              const resolved = staged.some((file) => file.path === path);
              return (
                <div
                  key={path}
                  data-conflict-item
                  data-selected={path === selectedPath}
                  className="grid h-7 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 pl-3.5 pr-2 transition-colors hover:bg-hover-glass data-[selected=true]:bg-selected-glass data-[selected=true]:shadow-[inset_3px_0_0_var(--color-warning)]"
                >
                  <button
                    type="button"
                    className="flex h-7 min-w-0 items-center gap-2 bg-transparent text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
                    onClick={() => {
                      setSelectedPath(path);
                      onSelectConflict?.(path);
                    }}
                  >
                    <span
                      className="grid size-4.5 shrink-0 place-items-center rounded-[4px] bg-warning/15 font-mono text-[10.5px] font-bold text-warning-ink"
                      aria-label="conflicted"
                      title={path}
                    >
                      !
                    </span>
                    <span className="truncate text-[12px]" title={path}>
                      {path}
                    </span>
                  </button>
                  {resolved ? (
                    <span className="shrink-0 pr-1 text-[11px] text-success-ink">resolved</span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Keep current version of ${base}`}
                        title={`Keep the current branch's (${branch}) version of ${base}`}
                        onClick={() => onResolve([path], "ours")}
                        className="rounded-full border border-hairline bg-glass-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-dim transition-colors hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60"
                      >
                        current
                      </button>
                      <button
                        type="button"
                        aria-label={`Keep incoming version of ${base}`}
                        title={`Keep the incoming branch's version of ${base}`}
                        onClick={() => onResolve([path], "theirs")}
                        className="rounded-full border border-hairline bg-glass-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-dim transition-colors hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60"
                      >
                        incoming
                      </button>
                      {/* Manual edit: the user resolved it in their editor — git add marks it. */}
                      <button
                        type="button"
                        aria-label={`Mark ${base} resolved`}
                        title="The conflict file was resolved in an editor — stage it"
                        onClick={() => onStage([path])}
                        className="rounded-full border border-hairline bg-glass-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-dim transition-colors hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60"
                      >
                        ✓
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </Section>
        )}

        <Section
          title="Staged"
          count={staged.length}
          empty="Nothing staged yet. Stage a file to prepare a commit."
          action={
            staged.length > 0
              ? {
                  label: "Unstage all",
                  title: "Move every file back to the working tree",
                  onClick: () => onUnstage(staged.map((file) => file.path)),
                }
              : undefined
          }
          disabled={staged.length === 0}
        >
          {staged.map((file) => (
            <ItemRow
              key={file.key}
              file={file}
              selected={isSelected(file)}
              onSelect={setSelectedPath}
              onSelectRow={onSelectRow}
              onUnstage={() => onUnstage([file.path])}
              onDiscard={() => setPendingDiscard(file)}
            />
          ))}
        </Section>

        <Section
          title="Changes"
          count={unstaged.length}
          empty="The working copy is clean."
          action={
            unstaged.length > 0
              ? {
                label: "Stage all",
                title: "Stage every working-tree change",
                onClick: () => onStage(unstaged.map((file) => file.path)),
              }
              : undefined
          }
        >
          {unstaged.map((file) => (
            <ItemRow
              key={file.key}
              file={file}
              selected={isSelected(file)}
              onSelect={setSelectedPath}
              onSelectRow={onSelectRow}
              onStage={() => onStage([file.path])}
              onDiscard={() => setPendingDiscard(file)}
            />
          ))}
        </Section>
      </div>

      <footer className="shrink-0 border-t border-hairline bg-sheet-band p-3">
        <textarea
          rows={2}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              handleCommit();
            }
          }}
          placeholder="Commit message"
          aria-label="Commit message"
          title="Ctrl+Enter commits the staged files"
          className="block w-full resize-none rounded-lg border border-transparent bg-glass-soft px-2.5 py-1.5 text-[12px] leading-normal text-ink placeholder:text-ink-dim focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={staged.length === 0 || message.trim() === "" || busy || merging}
            onClick={handleCommit}
            title={
              merging
                ? "A merge is in progress — take the sides, then complete it"
                : staged.length === 0
                  ? "Stage a file first"
                  : message.trim() === ""
                    ? "Write a commit message first"
                    : "Ctrl+Enter commits the staged files"
            }
            className="h-7 rounded-lg bg-primary px-3 text-[12px] font-semibold text-white transition-filter hover:brightness-110 focus-visible:ring-2 focus-visible:ring-primary-ink/70 disabled:opacity-60"
          >
            Commit
          </button>
          {merging ? (
            <button
              type="button"
              disabled={busy}
              onClick={onCompleteMerge}
              title="Commits the resolved merge with git's own prepared message"
              className="h-7 rounded-lg bg-primary px-3 text-[12px] font-semibold text-white transition-filter hover:brightness-110 focus-visible:ring-2 focus-visible:ring-primary-ink/70 disabled:opacity-60"
            >
              Complete merge
            </button>
          ) : (
            <span className="font-mono text-[10.5px] text-ink-dim">
              {busy ? "…" : staged.length > 0 ? `${staged.length} staged` : ""}
            </span>
          )}
          <button
            type="button"
            onClick={() => setPendingDiscard("all")}
            title="Discard every change, staged and unstaged"
            className="ml-auto shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold text-ink-dim transition-colors hover:bg-danger/15 hover:text-danger-ink focus-visible:ring-2 focus-visible:ring-primary/60 disabled:invisible"
            disabled={files.length === 0 || busy}
          >
            Discard all…
          </button>
        </div>
      </footer>

      {pendingDiscard !== null && (
        <ConfirmDialog
          title={
            pendingDiscard === "all"
              ? "Discard all uncommitted changes?"
              : pendingDiscard.untracked
                ? `Delete untracked ${pendingDiscard.path.split("/").pop()}?`
                : `Discard changes in ${pendingDiscard.path.split("/").pop()}?`
          }
          body={
            <p>
              {pendingDiscard === "all"
                ? "Every change — staged and unstaged — returns to the last commit, and untracked files are deleted from disk. Nothing in this list survives."
                : pendingDiscard.untracked
                  ? "The file is not tracked yet, so discarding deletes it from disk."
                  : "The file returns to its last committed state: edits, new files and renames all go."}
            </p>
          }
          confirmLabel="Discard"
          danger
          onConfirm={confirmDiscard}
          onClose={() => setPendingDiscard(null)}
        />
      )}

      {pendingAbort && (
        <ConfirmDialog
          title="Abort the merge?"
          body={
            <p>
              Everything from the merge goes: the conflicted files return to their pre-merge
              state, and the merged branch stays untouched (nothing was committed).
            </p>
          }
          confirmLabel="Abort merge"
          danger
          onConfirm={confirmAbort}
          onClose={() => setPendingAbort(false)}
        />
      )}
    </section>
  );
}
