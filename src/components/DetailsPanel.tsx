import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ChangedFile, Commit } from "../types";
import { formatAbsoluteDate } from "../lib/format";
import {
  DEFAULT_DETAILS_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_DETAILS_HEIGHT,
  MAX_SIDEBAR_WIDTH,
  MIN_DETAILS_HEIGHT,
  MIN_SIDEBAR_WIDTH,
} from "../lib/tableLayout";
import { PANEL } from "../lib/ui";
import { DiffViewer } from "./DiffViewer";
import { FileList } from "./FileList";
import { ResizeHandle } from "./ResizeHandle";
import { ChevronDownIcon, CloseIcon } from "./icons";

interface DetailsPanelProps {
  commit: Commit;
  files: ChangedFile[];
  filesLoading: boolean;
  selectedFile: ChangedFile | null;
  onSelectFile: (path: string) => void;
  onClose: () => void;
  onHeightChange: (height: number) => void;
}

export function DetailsPanel({
  commit,
  files,
  filesLoading,
  selectedFile,
  onSelectFile,
  onClose,
  onHeightChange,
}: DetailsPanelProps) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(false);
  // null = follow the content, capped so the file list always keeps most of the sidebar.
  const [summaryHeight, setSummaryHeight] = useState<number | null>(null);
  const pinned = summaryHeight !== null && !summaryCollapsed && !filesCollapsed;

  const layout = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  const summaryClasses = summaryCollapsed
    ? "relative flex shrink-0 flex-col gap-1.5 border-b border-rule px-3.5 py-2.5"
    : filesCollapsed
      ? "relative flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto border-b border-rule px-3.5 pb-3 pt-3"
      : [
          "relative flex shrink-0 flex-col gap-1.5 overflow-y-auto border-b border-rule px-3.5 pb-3 pt-3",
          // Content-driven until the divider is dragged; the 55% cap keeps files taller by default.
          pinned ? "" : "max-h-[55%]",
        ].join(" ");
  const summaryStyle: CSSProperties | undefined = pinned ? { height: `${summaryHeight}px` } : undefined;

  return (
    <section
      ref={sectionRef}
      data-details
      className={`${PANEL} relative grid min-h-0 grid-cols-[var(--sidebar-width)_minmax(0,1fr)] overflow-hidden`}
      style={layout}
      aria-label="Commit details"
    >
      <div
        ref={sidebarRef}
        data-details-sidebar
        className="flex min-h-0 flex-col border-r border-rule bg-glass-soft"
      >
        <div ref={summaryRef} className={summaryClasses} style={summaryStyle}>
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSummaryCollapsed((collapsed) => !collapsed)}
              aria-expanded={!summaryCollapsed}
              title={summaryCollapsed ? "Expand commit details" : "Collapse commit details"}
              className="grid h-6 w-6 shrink-0 cursor-default place-items-center rounded-full text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70"
            >
              <ChevronDownIcon className={summaryCollapsed ? "rotate-[-90deg]" : ""} />
            </button>
            <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 font-mono text-[11.5px] font-semibold text-primary-ink">
              {commit.hash}
            </span>
            {commit.parents.length > 1 && (
              <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-warning-ink">
                merge
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Hide details panel"
              aria-label="Hide details panel"
              className="ml-auto grid h-6 w-6 shrink-0 cursor-default place-items-center rounded-full text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70"
            >
              <CloseIcon />
            </button>
          </div>

          {!summaryCollapsed && (
            <>
              <h2 className="m-0 break-words text-[15px] font-bold leading-snug text-ink">
                {commit.subject}
              </h2>

              <div className="flex min-w-0 flex-col gap-0.5 text-[12px] text-ink-dim">
                <span className="text-[12.5px] font-semibold text-ink-soft">{commit.author}</span>
                <span className="truncate">{commit.authorEmail}</span>
                <span>{formatAbsoluteDate(commit.date)}</span>
                {commit.parents.length > 0 && (
                  <span className="break-words font-mono text-[10.5px]">
                    {commit.parents.length > 1 ? "parents" : "parent"}: {commit.parents.join(", ")}
                  </span>
                )}
              </div>

              {commit.body && (
                <p className="mb-0 mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink-soft">
                  {commit.body}
                </p>
              )}
            </>
          )}
        </div>

        {/* Zero-height anchor on the summary/files boundary; the splitter straddles it. */}
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
          collapsed={filesCollapsed}
          onToggleCollapse={() => setFilesCollapsed((collapsed) => !collapsed)}
        />
      </div>

      <DiffViewer file={selectedFile} />

      <ResizeHandle
        orientation="horizontal"
        label="Resize commit details height"
        className="top-0"
        min={MIN_DETAILS_HEIGHT}
        max={MAX_DETAILS_HEIGHT}
        measure={() =>
          sectionRef.current?.getBoundingClientRect().height ?? DEFAULT_DETAILS_HEIGHT
        }
        onResize={onHeightChange}
        onReset={() => onHeightChange(DEFAULT_DETAILS_HEIGHT)}
      />

      <ResizeHandle
        label="Resize commit details column"
        className="left-[var(--sidebar-width)]"
        min={MIN_SIDEBAR_WIDTH}
        max={MAX_SIDEBAR_WIDTH}
        value={sidebarWidth}
        measure={() => sidebarRef.current?.getBoundingClientRect().width ?? sidebarWidth}
        onResize={setSidebarWidth}
        onReset={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
      />
    </section>
  );
}
