import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ChangedFile } from "../types";
import { STATUS_LABELS, STATUS_TONES, numberDiffLines, type NumberedDiffLine } from "../lib/format";
import { splitDiffRows } from "../lib/gitDiffParser";
import { highlightSync, languageForPath, loadHighlighter, type SyntaxScheme } from "../lib/highlight";
import { isImageFile } from "../lib/imageDiff";
import { ImageDiff } from "./ImageDiff";
import { TextWrapIcon } from "./icons";

/**
 * Which files the diff pane shows. "file" is the classic one-file-at-a-time view; "all" stacks
 * every changed file in a single scroll (GitHub's "Files changed"), so reading a whole commit
 * never needs a click per file. The choice is persisted with the rest of the panel state.
 */
export type DiffScope = "file" | "all";

/** How the lines lay out: one stacked column, or old/new side by side (GitHub's split view). */
export type DiffLayout = "unified" | "split";

interface DiffViewerProps {
  files: ChangedFile[];
  /** The file selected in the list. In "all" scope it only says which section to scroll to. */
  file: ChangedFile | null;
  scope: DiffScope;
  onScopeChange: (scope: DiffScope) => void;
  layout: DiffLayout;
  onLayoutChange: (layout: DiffLayout) => void;
  /** Soft-wrap long lines (the default; the pane is narrow). Off = GitHub-style horizontal scroll. */
  wrap?: boolean;
  onWrapChange?: (wrap: boolean) => void;
  /** Which syntax palette the tokens use (see index.css `data-syntax` blocks). Default: app. */
  scheme?: SyntaxScheme;
  /** Where the image diff fetches its blobs: the repo path and the selected commit's hash. */
  repoPath?: string;
  commitHash?: string;
}

const PREFIX = {
  add: "+",
  remove: "-",
  context: " ",
} as const;

const LINE_TONES = {
  add: { lineNumberBox: "bg-success/30", row: "bg-success/10", text: "text-success-ink" },
  remove: { lineNumberBox: "bg-danger/30", row: "bg-danger/10", text: "text-danger-ink" },
  context: { lineNumberBox: "", row: "", text: "text-ink-soft" },
} as const;

/** Diff gutters: ink at low alpha, GitHub's muted gray — clearly fainter than the code next to
 * it, and .dark re-points it with the theme. */
const GUTTER_TONE = "text-ink/45";

/**
 * Highlighted HTML per line, filled once the file's grammar has loaded. Rows render plain
 * until then, and a file whose language we do not know just stays plain forever.
 */
function useHighlightedLines(file: ChangedFile, lines: NumberedDiffLine[]) {
  const [highlighted, setHighlighted] = useState<string[] | null>(null);
  useEffect(() => {
    setHighlighted(null);
    const language = languageForPath(file.path);
    if (!language || lines.length === 0) {
      setHighlighted(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const ready = await loadHighlighter(language);
      if (cancelled) return;
      if (!ready) {
        setHighlighted(null);
        return;
      }
      setHighlighted(lines.map((line) => highlightSync(line.text, language) ?? ""));
    })();
    return () => {
      cancelled = true;
    };
  }, [file, lines]);
  return highlighted;
}

/**
 * One file's diff lines, unified: one stacked column with its own lazy grammar load. Mounted
 * per file so the highlighting follows that file's language instead of whichever file was
 * selected before. The mount has to be forced per file (key={file.path} at the call sites):
 * reusing the instance across files kept the PREVIOUS file's token HTML on the new file's rows
 * until the new grammar resolved — the preview read as the other file.
 */
function DiffBody({ file, wrap }: { file: ChangedFile; wrap: boolean }) {
  const lines = useMemo(() => numberDiffLines(file.diff), [file]);
  const highlighted = useHighlightedLines(file, lines);
  // Wrap mode gives up max-content width: rows fill the pane and long lines soft-wrap.
  const rowSpace = wrap ? "min-w-full" : "w-max min-w-full";
  const contentSpace = wrap ? "whitespace-pre-wrap break-words pr-[18px]" : "whitespace-pre pr-[18px]";

  return (
    <>
      {lines.map((line, index) => {
        if (line.type === "hunk") {
          return (
            <div
              key={index}
              data-diff-line="hunk"
              className={`block w-full ${wrap ? "whitespace-pre-wrap" : "whitespace-pre"} bg-primary/[0.07] px-3.5 py-1 font-semibold text-primary-ink`}
            >
              {line.text}
            </div>
          );
        }

        const tone = LINE_TONES[line.type];
        const html = highlighted?.[index];
        // With tokens on, the content span drops the line tone colour: token spans carry the
        // palette, and only untokenized text keeps the soft base. The row tint stays.
        const contentClass = `${contentSpace} ${html === undefined ? tone.text : "text-ink-soft"}`;

        return (
          <div
            key={index}
            data-diff-line={line.type}
            className={`grid ${rowSpace} grid-cols-[44px_44px_14px_auto] ${tone.row}`}
          >
            <span
              className={`select-none border-r border-rule pr-2 text-right ${line.type === "remove" ? tone.lineNumberBox : GUTTER_TONE}`}
            >
              {line.oldNumber ?? ""}
            </span>
            <span
              className={`select-none border-r border-rule pr-2 text-right ${line.type === "add" ? tone.lineNumberBox : GUTTER_TONE}`}
            >
              {line.newNumber ?? ""}
            </span>
            <span className={`select-none text-center ${tone.text}`}>{PREFIX[line.type]}</span>
            {html !== undefined ? (
              <span className={contentClass} dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <span className={contentClass}>{line.text || " "}</span>
            )}
          </div>
        );
      })}
    </>
  );
}

/** The diff body routes itself: image files get the GitHub-style picture diff, text gets lines. */
function DiffSection({
  file,
  layout,
  wrap,
  repoPath,
  commitHash,
}: {
  file: ChangedFile;
  layout: DiffLayout;
  wrap: boolean;
  repoPath?: string;
  commitHash?: string;
}) {
  return isImageFile(file.path) ? (
    <ImageDiff key={file.path} file={file} repoPath={repoPath} commitHash={commitHash} />
  ) : layout === "split" ? (
    <SplitDiffBody key={file.path} file={file} wrap={wrap} />
  ) : (
    <DiffBody key={file.path} file={file} wrap={wrap} />
  );
}

/** The no-source-line side of a split row: a neutral ink wash, so "came from empty" reads at a
 * glance instead of looking like a blank context row. Ink alpha, so .dark re-points it. */
const VOID_TONE = "bg-ink/[0.06]";

/** One half of a split row: number + code. No line → blank cells that keep the track. */
function SplitCells({
  line,
  side,
  html,
  wrap,
}: {
  line: NumberedDiffLine | null;
  side: "old" | "new";
  html?: string;
  wrap: boolean;
}) {
  if (!line) {
    return (
      <>
        <span
          data-diff-num={side}
          className={`select-none border-r border-rule ${VOID_TONE}`}
        />
        <span
          data-diff-code={side}
          data-diff-line="empty"
          className={`border-r border-rule ${VOID_TONE}`}
        >
          {" "}
        </span>
      </>
    );
  }
  // Hunk rows never reach here (they span both panes above); narrow the tone lookup for tsc.
  const tone = LINE_TONES[line.type === "hunk" ? "context" : line.type];
  const number = side === "old" ? line.oldNumber : line.newNumber;
  const cellClass = `${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"} border-r border-rule pl-2 pr-2 ${tone.row}`;
  return (
    <>
      <span
        data-diff-num={side}
        className={`select-none border-r border-rule pr-2 text-right ${line.type === "add" || line.type === "remove" ? tone.lineNumberBox : GUTTER_TONE}`}
      >
        {number ?? ""}
      </span>
      {html !== undefined ? (
        <span
          data-diff-code={side}
          data-diff-line={line.type}
          className={`${cellClass} text-ink-soft`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <span data-diff-code={side} data-diff-line={line.type} className={`${cellClass} ${tone.text}`}>
          {line.text || " "}
        </span>
      )}
    </>
  );
}

/**
 * One file's diff lines, split: old on the left, new on the right, paired row by row. ONE grid
 * for the whole file — shared tracks keep the two panes' gutters aligned across rows, which
 * per-row grids cannot do (each row would size its own auto column). Same lazy grammar load
 * and per-file mount as the unified body.
 */
function SplitDiffBody({ file, wrap }: { file: ChangedFile; wrap: boolean }) {
  const lines = useMemo(() => numberDiffLines(file.diff), [file]);
  const rows = useMemo(() => splitDiffRows(lines), [lines]);
  const highlighted = useHighlightedLines(file, lines);

  // Wrap mode swaps the max-content auto tracks for fr tracks: both panes take half the pane
  // each and long lines soft-wrap inside. The one shared grid still keeps panes aligned.
  return (
    <div
      className={`grid ${wrap ? "min-w-full grid-cols-[36px_minmax(0,1fr)_36px_minmax(0,1fr)]" : "w-max min-w-full grid-cols-[36px_auto_36px_auto]"}`}
    >
      {rows.map((row, rowIndex) => {
        if (row.hunk) {
          return (
            <div
              key={rowIndex}
              data-diff-row="hunk"
              className={`col-span-4 block ${wrap ? "whitespace-pre-wrap" : "whitespace-pre"} bg-primary/[0.07] px-3.5 py-1 font-semibold text-primary-ink`}
            >
              {row.hunk.text}
            </div>
          );
        }
        return (
          <Fragment key={rowIndex}>
            <SplitCells
              line={row.old}
              side="old"
              html={row.oldIndex >= 0 ? highlighted?.[row.oldIndex] : undefined}
              wrap={wrap}
            />
            <SplitCells
              line={row.new}
              side="new"
              html={row.newIndex >= 0 ? highlighted?.[row.newIndex] : undefined}
              wrap={wrap}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

/** Path line, as "old → new" when the file moved, so a rename reads at a glance. */
function FilePath({ file }: { file: ChangedFile }) {
  if (!file.oldPath) {
    return (
      <span className="min-w-0 truncate font-mono text-[11.5px] font-medium text-ink" title={file.path}>
        {file.path}
      </span>
    );
  }
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 font-mono text-[11.5px]"
      title={`${file.oldPath} → ${file.path}`}
    >
      <span className="min-w-0 truncate text-ink-soft">{file.oldPath}</span>
      <span className="shrink-0 text-ink-dim">→</span>
      <span className="min-w-0 truncate font-medium text-ink">{file.path}</span>
    </span>
  );
}

/** Rename similarity, GitHub-style: only shown when the file actually changed while moving. */
function RenameScore({ file }: { file: ChangedFile }) {
  if (file.renameScore === undefined || file.renameScore >= 100) return null;
  return (
    <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10.5px] font-semibold text-primary-ink">
      {file.renameScore}%
    </span>
  );
}

/** One file's header: path, status, line counts. Sticky, for the stacked "all files" view. */
function FileHeader({ file }: { file: ChangedFile }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-rule bg-sheet-strong px-3.5 py-2 backdrop-blur-md">
      <FilePath file={file} />
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_TONES[file.status]}`}>
        {STATUS_LABELS[file.status]}
      </span>
      <RenameScore file={file} />
      <span className="ml-auto flex shrink-0 gap-2 font-mono text-[11px] font-semibold">
        <span className="text-success-ink">+{file.additions}</span>
        <span className="text-danger-ink">−{file.deletions}</span>
      </span>
    </div>
  );
}

/** The scope switch. Two segments rather than a checkbox: both states are named on screen. */
function ScopeToggle({
  scope,
  onScopeChange,
}: {
  scope: DiffScope;
  onScopeChange: (scope: DiffScope) => void;
}) {
  const segments: { value: DiffScope; label: string; title: string }[] = [
    { value: "file", label: "This file", title: "Only the selected file" },
    { value: "all", label: "All files", title: "Scroll through every changed file" },
  ];

  return (
    <div
      role="group"
      aria-label="Diff scope"
      className="flex shrink-0 items-center gap-0.5 rounded-full border border-hairline bg-glass-soft p-0.5 backdrop-blur-md"
    >
      {segments.map((segment) => (
        <button
          key={segment.value}
          type="button"
          data-diff-scope={segment.value}
          aria-pressed={scope === segment.value}
          title={segment.title}
          onClick={() => onScopeChange(segment.value)}
          className={`h-5.5 cursor-default rounded-full px-2.5 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 ${
            scope === segment.value
              ? "bg-primary text-white"
              : "text-ink-dim hover:bg-hover-glass hover:text-ink"
          }`}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}

/** The layout switch: unified stacks old and new in one column, split puts them side by side. */
function LayoutToggle({
  layout,
  onLayoutChange,
}: {
  layout: DiffLayout;
  onLayoutChange: (layout: DiffLayout) => void;
}) {
  const segments: { value: DiffLayout; label: string; title: string }[] = [
    { value: "unified", label: "Unified", title: "Additions and deletions stacked in one column" },
    { value: "split", label: "Split", title: "Old lines on the left, new lines on the right" },
  ];

  return (
    <div
      role="group"
      aria-label="Diff layout"
      className="flex shrink-0 items-center gap-0.5 rounded-full border border-hairline bg-glass-soft p-0.5 backdrop-blur-md"
    >
      {segments.map((segment) => (
        <button
          key={segment.value}
          type="button"
          data-diff-layout={segment.value}
          aria-pressed={layout === segment.value}
          title={segment.title}
          onClick={() => onLayoutChange(segment.value)}
          className={`h-5.5 cursor-default rounded-full px-2.5 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 ${
            layout === segment.value
              ? "bg-primary text-white"
              : "text-ink-dim hover:bg-hover-glass hover:text-ink"
          }`}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}

/** The wrap switch: a pressed icon button, not a segment pair — it is one behaviour, on or off. */
function WrapToggle({
  wrap,
  onWrapChange,
}: {
  wrap: boolean;
  onWrapChange?: (wrap: boolean) => void;
}) {
  return (
    <button
      type="button"
      data-diff-wrap
      aria-pressed={wrap}
      aria-label="Wrap long lines"
      title={wrap ? "Scroll long lines" : "Wrap long lines"}
      onClick={() => onWrapChange?.(!wrap)}
      className={`grid size-6 shrink-0 cursor-default place-items-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 ${
        wrap
          ? "border-primary/40 bg-primary/15 text-primary-ink"
          : "border-hairline bg-glass-soft text-ink-dim backdrop-blur-md hover:bg-hover-glass hover:text-ink"
      }`}
    >
      <TextWrapIcon />
    </button>
  );
}

export function DiffViewer({
  files,
  file,
  scope,
  onScopeChange,
  layout = "unified",
  onLayoutChange,
  wrap = true,
  onWrapChange,
  scheme = "app",
  repoPath,
  commitHash,
}: DiffViewerProps) {
  const totals = useMemo(
    () =>
      files.reduce(
        (sum, item) => ({
          additions: sum.additions + item.additions,
          deletions: sum.deletions + item.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );

  // In "all" scope the file list on the left is a jump list: selecting a file scrolls its
  // section into view. jsdom has no scrollIntoView, so the call is guarded, not assumed.
  const sections = useRef(new Map<string, HTMLElement>());
  const target = file?.path ?? null;
  useEffect(() => {
    if (scope !== "all" || !target) return;
    const node = sections.current.get(target);
    if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "start" });
  }, [scope, target, files]);

  return (
    <div data-diff data-syntax={scheme} className="flex min-h-0 min-w-0 flex-col bg-sheet">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-rule px-3.5 py-2">
        {scope === "all" ? (
          <span className="min-w-0 truncate font-mono text-[11.5px] font-medium text-ink">
            {files.length} file{files.length === 1 ? "" : "s"} changed
          </span>
        ) : file ? (
          <FilePath file={file} />
        ) : (
          <span className="min-w-0 truncate font-mono text-[11.5px] font-medium text-ink">Diff</span>
        )}
        {scope === "file" && file && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_TONES[file.status]}`}>
            {STATUS_LABELS[file.status]}
          </span>
        )}
        {scope === "file" && file && <RenameScore file={file} />}
        <span className="ml-auto flex shrink-0 gap-2 font-mono text-[11px] font-semibold">
          <span className="text-success-ink">
            +{scope === "all" ? totals.additions : (file?.additions ?? 0)}
          </span>
          <span className="text-danger-ink">
            −{scope === "all" ? totals.deletions : (file?.deletions ?? 0)}
          </span>
        </span>
        <WrapToggle wrap={wrap} onWrapChange={onWrapChange} />
        <LayoutToggle layout={layout} onLayoutChange={onLayoutChange} />
        <ScopeToggle scope={scope} onScopeChange={onScopeChange} />
      </div>

      {scope === "all" ? (
        files.length === 0 ? (
          <p className="m-0 p-4 text-[12px] text-ink-dim">No file changes in this commit.</p>
        ) : (
          // One scroll container with every file stacked under a sticky header, each keeping its
          // own grammar. Never split into pages — the point is to keep scrolling.
          <div className="min-h-0 flex-1 overflow-auto bg-sheet pb-3 font-mono text-[12px] leading-[1.6]">
            {files.map((item) => (
              <section
                key={item.path}
                data-diff-file={item.path}
                ref={(node) => {
                  if (node) sections.current.set(item.path, node);
                  else sections.current.delete(item.path);
                }}
                className="scroll-mt-8"
              >
                <FileHeader file={item} />
                <div className="pt-1">
                  <DiffSection
                    file={item}
                    layout={layout}
                    wrap={wrap}
                    repoPath={repoPath}
                    commitHash={commitHash}
                  />
                </div>
              </section>
            ))}
          </div>
        )
      ) : (
        // One file at a time: the panel header above IS this file's header.
        <div className="min-h-0 flex-1 overflow-auto bg-sheet pb-3 pt-1 font-mono text-[12px] leading-[1.6]">
          {file ? (
            <DiffSection
              file={file}
              layout={layout}
              wrap={wrap}
              repoPath={repoPath}
              commitHash={commitHash}
            />
          ) : (
            <p className="m-0 p-4 font-sans text-[12px] text-ink-dim">
              Select a changed file to see its diff.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
