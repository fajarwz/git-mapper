import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ChangedFile, Commit, PullRequest, Submodule } from "../../types";
import { pullRequestForRef, type PullChipData } from "../pull-requests/lib/pullRequests";
import { PullRequestChip } from "../pull-requests/components/PullRequestChip";
import { copyText } from "../../shared/lib/clipboard";
import { formatAbsoluteDate } from "../../shared/lib/format";
import type { SyntaxScheme } from "../diff/lib/highlight";
import { STORAGE_KEYS, usePersistedState } from "../../shared/lib/persisted";
import {
  DEFAULT_DETAILS_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_DETAILS_HEIGHT,
  MAX_SIDEBAR_WIDTH,
  MIN_DETAILS_HEIGHT,
  MIN_SIDEBAR_WIDTH,
} from "../history/lib/tableLayout";
import { PANEL } from "../../shared/lib/ui";
import { Avatar } from "../history/components/Avatar";
import { DiffViewer, type DiffLayout, type DiffScope, type HunkActions } from "../diff/components/DiffViewer";
import { ConflictViewer, type ConflictFile } from "../conflicts/ConflictViewer";
import { FileList, type FileView } from "../diff/components/FileList";
import { RefPill } from "../history/components/RefPill";
import { Marked } from "../history/components/Marked";
import type { CommitRef } from "../../types";
import { ResizeHandle } from "../../shared/components/ResizeHandle";
import { ChevronDownIcon, CloseIcon } from "../../shared/components/icons";

interface DetailsPanelProps {
  commit: Commit;
  repoPath: string;
  files: ChangedFile[];
  filesLoading: boolean;
  selectedFile: ChangedFile | null;
  onSelectFile: (path: string) => void;
  diffScope: DiffScope;
  onDiffScopeChange: (scope: DiffScope) => void;
  diffLayout: DiffLayout;
  onDiffLayoutChange: (layout: DiffLayout) => void;
  diffWrap: boolean;
  onDiffWrapChange: (wrap: boolean) => void;
  syntaxScheme: SyntaxScheme;
  showAvatars: boolean;
  pullsByBranch?: Map<string, PullRequest>;
  commitChip?: (commit: Commit) => PullChipData | null;
  terms?: string[];
  onCheckoutBranch?: (branch: string) => void;
  onRefContextMenu?: (ref: CommitRef, x: number, y: number) => void;
  isWorktree?: boolean;
  /** Asks App for one file's patch (patches are lazy; the file list arrives without them). */
  onPatchNeeded?: (path: string) => void;
  /** Uncommitted diff only: the per-hunk buttons and the side (staged / working tree) on show. */
  hunkActions?: HunkActions;
  conflict?: ConflictFile | null;
  onResolveConflict?: (paths: string[], side: "ours" | "theirs") => void;
  /** Saves the conflicted file after a block choice; resolves once the rewrite landed. */
  onWriteConflictText?: (path: string, text: string) => Promise<void>;
  currentBranch?: string;
  submodules?: Submodule[];
  onOpenSubmodule?: (fullPath: string) => void;
  onClose: () => void;
  onHeightChange: (height: number) => void;
}

export function DetailsPanel({
  commit,
  repoPath,
  files,
  filesLoading,
  selectedFile,
  onSelectFile,
  diffScope,
  onDiffScopeChange,
  diffLayout,
  onDiffLayoutChange,
  diffWrap,
  onDiffWrapChange,
  syntaxScheme,
  showAvatars,
  pullsByBranch,
  commitChip,
  terms,
  onCheckoutBranch,
  onRefContextMenu,
  isWorktree = false,
  onPatchNeeded,
  hunkActions,
  conflict,
  onResolveConflict,
  onWriteConflictText,
  currentBranch = "",
  submodules,
  onOpenSubmodule,
  onClose,
  onHeightChange,
}: DetailsPanelProps) {
  const submodulePaths = useMemo(
    () => new Set((submodules ?? []).map((item) => item.path)),
    [submodules],
  );
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(false);
  // Flat path list or the folder tree for the changed files. The panel owns it (not App) so the
  // whole file-list domain lives here; the choice is persisted like the rest of the panel state.
  const [fileView, setFileView] = usePersistedState<FileView>(STORAGE_KEYS.fileView, "list");
  const [hashCopied, setHashCopied] = useState(false);
  const hashTimer = useRef(0);

  function copyHash() {
    void copyText(commit.hash).then(() => {
      setHashCopied(true);
      window.clearTimeout(hashTimer.current);
      hashTimer.current = window.setTimeout(() => setHashCopied(false), 900);
    });
  }
  // null = follow the content, capped so the file list always keeps most of the sidebar.
  const [summaryHeight, setSummaryHeight] = useState<number | null>(null);
  const pinned = summaryHeight !== null && !summaryCollapsed && !filesCollapsed;

  const layout = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  // The summary is laid out as two blocks: the title row is a banded header strip (it doubles as
  // the panel header) that shares the file preview's header band, and the meta/body below stays
  // on the panel's own glass. Padding lives on the children so the band can reach both edges.
  const summaryClasses = summaryCollapsed
    ? "relative flex shrink-0 flex-col"
    : filesCollapsed
      ? "relative flex min-h-0 flex-1 flex-col overflow-y-auto border-b border-rule"
      : [
          "relative flex shrink-0 flex-col overflow-y-auto border-b border-rule",
          // Content-driven until the divider is dragged; the 55% cap keeps files taller by default.
          pinned ? "" : "max-h-[55%]",
        ].join(" ");
  const summaryStyle: CSSProperties | undefined = pinned ? { height: `${summaryHeight}px` } : undefined;

  // The uncommitted context: the rail owns the file list, so this panel drops its sidebar
  // entirely and the diff takes the whole pane — the full-view click, without a duplicate
  // list to maintain next to the staging rail.
  const showSidebar = !isWorktree;
  const diffViewer = conflict ? (
    <ConflictViewer
      conflict={conflict}
      currentBranch={currentBranch}
      scheme={syntaxScheme}
      onResolve={(side) => onResolveConflict?.([conflict.path], side)}
      onWriteText={(text) => onWriteConflictText?.(conflict.path, text) ?? Promise.resolve()}
    />
  ) : (
    <DiffViewer
      files={files}
      file={selectedFile}
      scope={diffScope}
      onScopeChange={onDiffScopeChange}
      layout={diffLayout}
      onLayoutChange={onDiffLayoutChange}
      wrap={diffWrap}
      onWrapChange={onDiffWrapChange}
      scheme={syntaxScheme}
      repoPath={repoPath}
      commitHash={commit.hash}
      onPatchNeeded={onPatchNeeded}
      hunkActions={hunkActions}
      submodules={submodules}
      onOpenSubmodule={onOpenSubmodule}
    />
  );

  return (
    <section
      ref={sectionRef}
      data-details
      className={`${
        showSidebar
          ? `${PANEL} relative grid min-h-0 grid-cols-[var(--sidebar-width)_minmax(0,1fr)] overflow-hidden`
          : `${PANEL} relative flex min-h-0 flex-col overflow-hidden`
      } slide-in-up`}
      style={showSidebar ? layout : undefined}
      aria-label={showSidebar ? "Commit details" : "Uncommitted diff"}
    >
      {showSidebar ? (
        <>
          <div
            ref={sidebarRef}
            data-details-sidebar
            className="flex min-h-0 flex-col border-r border-rule bg-glass-soft"
          >
            <div ref={summaryRef} className={summaryClasses} style={summaryStyle}>
              <div className="flex min-w-0 shrink-0 items-center gap-1.5 border-b border-hairline bg-sheet-band px-3.5 py-2">
                <button
                  type="button"
                  onClick={() => setSummaryCollapsed((collapsed) => !collapsed)}
                  aria-expanded={!summaryCollapsed}
                  title={summaryCollapsed ? "Expand commit details" : "Collapse commit details"}
                  className="grid shrink-0 place-items-center rounded-full text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 size-6"
                >
                  <ChevronDownIcon className={summaryCollapsed ? "-rotate-90" : ""} />
                </button>
                {/* The subject IS the panel title, so it survives a collapse (the hash lives in the
                    meta block below). Expanded it wraps fully; collapsed it stays a one-line row. */}
                <span
                  className={`min-w-0 flex-1 text-[12.5px] font-bold text-ink ${
                    summaryCollapsed ? "truncate" : "wrap-break-word leading-snug"
                  }`}
                >
                  <Marked text={commit.subject} terms={terms} />
                </span>
                {commit.parents.length > 1 && (
                  <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-warning-ink">
                    merge
                  </span>
                )}
                {commit.stashIndex !== undefined && (
                  <span className="shrink-0 rounded-full bg-secondary/15 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-secondary">
                    stash
                  </span>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  title="Hide details panel"
                  aria-label="Hide details panel"
                  className="ml-auto grid shrink-0 place-items-center rounded-full text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 size-6"
                >
                  <CloseIcon />
                </button>
              </div>

              {!summaryCollapsed && (
                <div className="flex min-w-0 flex-col gap-2.5 px-3.5 pb-3 pt-2.5">
                  <div className="flex min-w-0 items-start gap-2">
                    {showAvatars && <Avatar name={commit.author} email={commit.authorEmail} photos />}
                    <div className="flex min-w-0 flex-1 flex-col gap-0">
                      <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink">
                        <Marked text={commit.author} terms={terms} />
                      </span>
                      <span className="min-w-0 truncate text-[11px] text-ink-dim">
                        <Marked text={commit.authorEmail} terms={terms} />
                      </span>
                    </div>
                    <time
                      dateTime={commit.date}
                      title={formatAbsoluteDate(commit.date)}
                      className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-ink-dim"
                    >
                      {formatAbsoluteDate(commit.date)}
                    </time>
                  </div>

                  <div className="flex min-h-5 min-w-0 items-center gap-1.5 justify-between">
                    <button
                      type="button"
                      onClick={copyHash}
                      title={hashCopied ? undefined : "Copy full commit hash"}
                      className="w-fit rounded font-mono text-[11px] text-ink-soft hover:bg-hover-glass"
                    >
                      {hashCopied ? "Copied!" : <Marked text={commit.hash.slice(0, 10)} terms={terms} />}
                    </button>
                    {(() => {
                      const chip = commit.stashIndex === undefined ? commitChip?.(commit) : null;
                      return chip ? <PullRequestChip chip={chip} className="w-fit ring-hairline" /> : null;
                    })()}

                    {commit.refs.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {commit.refs.map((pillRef) => (
                          <RefPill
                            key={`${pillRef.type}:${pillRef.name}`}
                            ref={pillRef}
                            pullRequest={pullsByBranch && pullRequestForRef(pillRef, pullsByBranch)}
                            color={commit.branchColor}
                            onCheckout={onCheckoutBranch}
                            onContextMenu={onRefContextMenu}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {commit.body && (
                    <p className="mb-0 mt-0.5 whitespace-pre-wrap wrap-break-word text-[12.5px] leading-relaxed text-ink-soft">
                      <Marked text={commit.body} terms={terms} />
                    </p>
                  )}
                </div>
              )}
            </div>

            {!summaryCollapsed && !filesCollapsed && (
              <div className="relative h-0 shrink-0">
                <ResizeHandle
                  orientation="horizontal"
                  invert
                  label="Resize commit summary height"
                  className="left-0 top-0"
                  min={88}
                  max={Math.max(300, (sidebarRef.current?.clientHeight ?? 560) - 220)}
                  measure={() => summaryRef.current?.getBoundingClientRect().height ?? 0}
                  onResize={setSummaryHeight}
                  onReset={() => setSummaryHeight(null)}
                />
              </div>
            )}

            <FileList
              files={files}
              loading={filesLoading}
              selectedPath={selectedFile?.path ?? null}
              onSelect={onSelectFile}
              onHoverFile={onPatchNeeded}
              collapsed={filesCollapsed}
              onToggleCollapse={() => setFilesCollapsed((collapsed) => !collapsed)}
              view={fileView}
              onViewChange={setFileView}
              submodulePaths={submodulePaths}
            />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{diffViewer}</div>
        </>
      ) : (
        <>
          <div className="relative flex h-8 shrink-0 items-center gap-2 border-b border-hairline bg-sheet-band pl-4 pr-1.5 text-[11.5px] font-semibold text-ink-dim">
            <span className="truncate">Uncommitted changes</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Hide the uncommitted diff"
              title="Hide the uncommitted diff"
              className="ml-auto grid size-7 shrink-0 place-items-center rounded-full text-ink-dim transition-colors hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <CloseIcon size={10} />
            </button>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{diffViewer}</div>
        </>
      )}

      <ResizeHandle
        orientation="horizontal"
        label={showSidebar ? "Resize commit details height" : "Resize uncommitted diff height"}
        className="top-0"
        min={MIN_DETAILS_HEIGHT}
        max={MAX_DETAILS_HEIGHT}
        measure={() =>
          sectionRef.current?.getBoundingClientRect().height ?? DEFAULT_DETAILS_HEIGHT
        }
        onResize={onHeightChange}
        onReset={() => onHeightChange(DEFAULT_DETAILS_HEIGHT)}
      />

      {showSidebar && (
        <ResizeHandle
          label="Resize commit details column"
          className="left-(--sidebar-width)"
          min={MIN_SIDEBAR_WIDTH}
          max={MAX_SIDEBAR_WIDTH}
          value={sidebarWidth}
          measure={() => sidebarRef.current?.getBoundingClientRect().width ?? sidebarWidth}
          onResize={setSidebarWidth}
          onReset={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
        />
      )}
    </section>
  );
}
