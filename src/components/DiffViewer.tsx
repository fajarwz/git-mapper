import { Fragment, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { ChangedFile } from "../types";
import {
  STATUS_LABELS,
  STATUS_TONES,
  fileNameTone,
  fileTitle,
  numberDiffLines,
  type NumberedDiffLine,
} from "../lib/format";
import { splitDiffRows, type DiffSplitRow } from "../lib/gitDiffParser";
import { useHighlightedLines } from "../hooks/useHighlightedLines";
import { useLineSelection, type LineSelection } from "../hooks/useLineSelection";
import type { SyntaxScheme } from "../lib/highlight";
import { intralineRanges, markedLine, type Range } from "../lib/intraline";
import { isImageFile } from "../lib/imageDiff";
import { ImageDiff } from "./ImageDiff";
import { HunkButtons, type HunkActions } from "./HunkButtons";
import { TextWrapIcon } from "./icons";

export type { HunkActions } from "./HunkButtons";

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
  /**
   * Asks App to read one file's lazy patch — the file list arrives without patches; the
   * selected file asks at mount, stacked sections ask on scroll-in (240px margin).
   */
  onPatchNeeded?: (path: string) => void;
  /** Uncommitted diff only: per-hunk stage / unstage / discard buttons, and which side this is. */
  hunkActions?: HunkActions;
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

/** With hunk buttons the header pins under the pane top (or the file header, in the stacked
 * view: --diff-sticky-top), so Stage/Discard stay in reach while you tick lines far down a hunk.
 * Frosted: a mostly-opaque glass fill with a heavy blur, so lines scrolling beneath smear into a
 * wash instead of competing with the header text; the primary tint is a gradient layer on top. */
const PINNED_HUNK =
  "group/hunk sticky top-[var(--diff-sticky-top,0px)] z-[5] bg-glass-strong bg-linear-to-b from-primary/[0.07] to-primary/[0.07] backdrop-blur-xl";

/** One wrapper per hunk, so a pinned hunk header stays inside its own hunk and the next one
 * takes the top instead of piling on it. Without hunk buttons nothing is pinned: stay flat. */
function groupByHunk(isHunk: boolean[], nodes: ReactNode[], className: string, group: boolean) {
  if (!group) return nodes;
  const groups: ReactNode[][] = [];
  nodes.forEach((node, index) => {
    if (isHunk[index] || groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(node);
  });
  return groups.map((members, index) => (
    <div key={index} className={className || undefined}>
      {members}
    </div>
  ));
}

/** A ticked changed line: a solid primary wash replaces its add/remove tint. */
const PICKED_ROW = "bg-primary/20";

/** Keyboard focus on a tick box: a ring inside the cell (the pick cells are tab-reachable). */
const PICK_FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/70";

/** The tick box itself: shown on row hover, filled with a check once picked. */
function PickBox({ picked, hoverGroup }: { picked: boolean; hoverGroup: string }) {
  return (
    <span
      aria-hidden
      data-pick-box
      className={`${picked ? "inline-flex" : `hidden ${hoverGroup}`} size-[11px] items-center justify-center rounded-[3px] border align-middle ${picked ? "border-primary bg-primary text-surface" : "border-ink/45 bg-surface/60"}`}
    >
      {picked && (
        <svg viewBox="0 0 10 10" className="size-[8px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 5.2 4.1 7.3 8 2.9" />
        </svg>
      )}
    </span>
  );
}

/** What the hunk header says on hover: how to pick, or why this file only takes whole hunks. */
function hunkHint(
  file: ChangedFile,
  hunkActions: HunkActions | undefined,
  selection: LineSelection | null,
  hunkIndex: number,
  header: string,
): string | undefined {
  if (!hunkActions?.onLines || !header.startsWith("@@ -")) return undefined;
  if (file.status !== "modified") return "Lines can only be picked in a file that exists on both sides";
  if (selection && selection.pickedIn(hunkIndex).length === 0) {
    return "Click a gutter to pick lines · drag or Shift-click for a range";
  }
  return undefined;
}

function HunkHint({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <span className="hidden shrink-0 font-sans text-[10.5px] font-normal text-ink-dim group-hover/hunk:inline">
      {text}
    </span>
  );
}

/** Line picking needs a file that exists on both sides, and a caller that can act on lines. */
const canPickLines = (file: ChangedFile, hunkActions?: HunkActions) =>
  Boolean(hunkActions?.onLines) && file.status === "modified";

/** Diff gutters: ink at low alpha, GitHub's muted gray — clearly fainter than the code next to
 * it, and .dark re-points it with the theme. */
const GUTTER_TONE = "text-ink/45";

/** The props that make a gutter cell a tick box; undefined when the line cannot be picked. */
interface PickProps {
  role: "checkbox";
  tabIndex: 0 | -1;
  "aria-checked": boolean;
  "aria-label": string;
  "data-line-pick": true;
  onMouseDown: (event: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

/** `group` = the lines that tick together: a split row's remove and add are one change. Only the
 * first changed line of a hunk is a tab stop; Up/Down walk the rest, Esc clears the hunk. */
function pickProps(
  selection: LineSelection | null,
  lineIndex: number,
  group: number[] = [lineIndex],
  label = "line",
): PickProps | undefined {
  const slot = selection?.slots[lineIndex];
  if (!selection || lineIndex < 0 || !slot) return undefined;
  return {
    role: "checkbox",
    tabIndex: slot.ordinal === 0 ? 0 : -1,
    "aria-checked": group.every(selection.isPicked),
    "aria-label": `Pick ${label}`,
    "data-line-pick": true,
    onMouseDown: (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      selection.begin(group, event.shiftKey);
    },
    onMouseEnter: () => selection.enter(group),
    onKeyDown: (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        selection.toggleGroup(group);
      } else if (event.key === "Escape") {
        selection.clear(slot.hunk);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const all = [...document.querySelectorAll<HTMLElement>("[data-line-pick]")];
        all[all.indexOf(event.currentTarget) + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
      }
    },
  };
}

/** Screen-reader name of a changed line: kind and number. */
const pickLabel = (line: NumberedDiffLine) =>
  `${line.type === "add" ? "added" : "removed"} line ${line.newNumber ?? line.oldNumber ?? ""}`.trim();

/** The changed lines of one split row: its remove and add are picked as a pair. */
function changeGroup(selection: LineSelection | null, row: DiffSplitRow): number[] {
  return [row.oldIndex, row.newIndex].filter((index) => index >= 0 && selection?.slots[index]);
}

function rowPicked(selection: LineSelection | null, row: DiffSplitRow): boolean {
  const group = changeGroup(selection, row);
  return group.length > 0 && group.every((index) => selection?.isPicked(index));
}

const clearHunk = (selection: LineSelection, hunk: number) => () => selection.clear(hunk);

/**
 * One file's diff lines, unified: one stacked column with its own lazy grammar load. Mounted
 * per file so the highlighting follows that file's language instead of whichever file was
 * selected before. The mount has to be forced per file (key={file.path} at the call sites):
 * reusing the instance across files kept the PREVIOUS file's token HTML on the new file's rows
 * until the new grammar resolved — the preview read as the other file.
 */
function DiffBody({
  file,
  wrap,
  hunkActions,
}: {
  file: ChangedFile;
  wrap: boolean;
  hunkActions?: HunkActions;
}) {
  const lines = useMemo(() => numberDiffLines(file.diff ?? []), [file]);
  const texts = useMemo(() => lines.map((line) => line.text), [lines]);
  const highlighted = useHighlightedLines(file.path, texts);
  const changes = useMemo(() => intralineRanges(lines), [lines]);
  const selection = useLineSelection(file.diff, canPickLines(file, hunkActions));
  // Wrap mode gives up max-content width: rows fill the pane and long lines soft-wrap.
  // Unwrapped, one w-max box holds every row: each row stretches to the widest line, so tints
  // and hunk bars end together instead of at their own text width.
  const rowSpace = "min-w-full";
  const contentSpace = wrap ? "whitespace-pre-wrap break-words pr-[18px]" : "whitespace-pre pr-[18px]";
  let hunkIndex = -1;

  return (
    <div className={wrap ? undefined : "w-max min-w-full"}>
      {groupByHunk(
        lines.map((line) => line.type === "hunk"),
        lines.map((line, index) => {
        if (line.type === "hunk") {
          hunkIndex += 1;
          return (
            <div
              key={index}
              data-diff-line="hunk"
              className={`${hunkActions ? `flex items-center gap-2 ${PINNED_HUNK}` : "block bg-primary/[0.07]"} w-full ${wrap ? "whitespace-pre-wrap" : "whitespace-pre"} px-3.5 py-1 font-semibold text-primary-ink`}
            >
              {hunkActions ? <span className="min-w-0">{line.text}</span> : line.text}
              <HunkHint text={hunkHint(file, hunkActions, selection, hunkIndex, line.text)} />
              {hunkActions && (
                <HunkButtons
                  path={file.path}
                  index={hunkIndex}
                  header={line.text}
                  actions={hunkActions}
                  picked={selection?.pickedIn(hunkIndex)}
                  counts={selection?.countsIn(hunkIndex)}
                  onClear={selection ? clearHunk(selection, hunkIndex) : undefined}
                />
              )}
            </div>
          );
        }

        const tone = LINE_TONES[line.type];
        const tokens = highlighted?.[index];
        const html = markedLine(line, tokens, changes.get(index));
        // With tokens on, the content span drops the line tone colour: token spans carry the
        // palette, and only untokenized text keeps the soft base. The row tint stays.
        const contentClass = `${contentSpace} ${tokens === undefined ? tone.text : "text-ink-soft"}`;

        const pick = pickProps(selection, index, [index], pickLabel(line));
        const picked = selection?.isPicked(index) ?? false;
        const gutterClick = pick
          ? { onMouseDown: pick.onMouseDown, onMouseEnter: pick.onMouseEnter }
          : {};
        const gutterCursor = pick ? " cursor-pointer" : "";

        return (
          <div
            key={index}
            data-diff-line={line.type}
            data-line-picked={picked || undefined}
            className={`group/row grid ${rowSpace} grid-cols-[44px_44px_14px_auto] ${picked ? PICKED_ROW : tone.row}`}
          >
            <span
              {...gutterClick}
              className={`select-none border-r border-rule pr-2 text-right ${line.type === "remove" ? tone.lineNumberBox : GUTTER_TONE}${gutterCursor}`}
            >
              {line.oldNumber ?? ""}
            </span>
            <span
              {...gutterClick}
              className={`select-none border-r border-rule pr-2 text-right ${line.type === "add" ? tone.lineNumberBox : GUTTER_TONE}${gutterCursor}`}
            >
              {line.newNumber ?? ""}
            </span>
            <span
              {...pick}
              className={`select-none text-center ${tone.text}${gutterCursor}${pick ? ` ${PICK_FOCUS}` : ""}`}
            >
              {pick ? (
                <span className="flex h-[1.6em] items-center justify-center">
                  <span className={picked ? "hidden" : "group-hover/row:hidden"}>{PREFIX[line.type]}</span>
                  <PickBox picked={picked} hoverGroup="group-hover/row:inline-flex" />
                </span>
              ) : (
                PREFIX[line.type]
              )}
            </span>
            {html !== undefined ? (
              <span className={contentClass} dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <span className={contentClass}>{line.text || " "}</span>
            )}
          </div>
        );
      }),
        "",
        Boolean(hunkActions),
      )}
    </div>
  );
}

const SKELETON_WIDTHS = ["w-2/5", "w-3/4", "w-1/2", "w-5/6", "w-2/3", "w-1/3", "w-3/5", "w-4/5"];

/** Placeholder rows shown while a patch loads, so a click answers before git does. */
function DiffSkeleton({ path }: { path: string }) {
  return (
    <div
      data-diff-loading={path}
      role="status"
      aria-label="Loading diff"
      className="flex animate-pulse flex-col gap-2.5 px-3.5 py-3"
    >
      {SKELETON_WIDTHS.map((width, index) => (
        <div key={index} className="flex items-center gap-3">
          <span className="h-2.5 w-7 shrink-0 rounded-full bg-ink/10" />
          <span className={`h-2.5 rounded-full bg-ink/[0.07] ${width}`} />
        </div>
      ))}
    </div>
  );
}

/** The diff body routes itself: image files get the GitHub-style picture diff, text gets lines. */
function DiffSection({
  file,
  layout,
  wrap,
  repoPath,
  commitHash,
  hunkActions,
}: {
  file: ChangedFile;
  layout: DiffLayout;
  wrap: boolean;
  repoPath?: string;
  commitHash?: string;
  hunkActions?: HunkActions;
}) {
  return isImageFile(file.path) ? (
    <ImageDiff key={file.path} file={file} repoPath={repoPath} commitHash={commitHash} />
  ) : file.diff === null ? (
    <DiffSkeleton path={file.path} />
  ) : layout === "split" ? (
    <SplitDiffBody key={file.path} file={file} wrap={wrap} hunkActions={hunkActions} />
  ) : (
    <DiffBody key={file.path} file={file} wrap={wrap} hunkActions={hunkActions} />
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
  ranges,
  wrap,
  pick,
  picked = false,
}: {
  line: NumberedDiffLine | null;
  side: "old" | "new";
  html?: string;
  /** Changed words of this line against its paired line on the other side. */
  ranges?: Range[];
  wrap: boolean;
  /** Present when this line can be ticked for a line-level stage/unstage/discard. */
  pick?: PickProps;
  picked?: boolean;
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
  const cellClass = `${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"} border-r border-rule pl-2 pr-2 ${picked ? PICKED_ROW : tone.row}`;
  const marked = markedLine(line, html, ranges);
  return (
    <>
      <span
        data-diff-num={side}
        {...pick}
        className={`group/cell select-none border-r border-rule text-right ${pick ? "" : "pr-2"} ${line.type === "add" || line.type === "remove" ? tone.lineNumberBox : GUTTER_TONE}${pick ? ` cursor-pointer ${PICK_FOCUS}` : ""}`}
      >
        {pick ? (
          // Box and number share one line box, so they centre on the same line however tall the row.
          <span className="flex items-center gap-x-1 pl-1 pr-2">
            <PickBox picked={picked} hoverGroup="group-hover/cell:inline-flex" />
            <span className="ml-auto">{number ?? ""}</span>
          </span>
        ) : (
          (number ?? "")
        )}
      </span>
      {marked !== undefined ? (
        <span
          data-diff-code={side}
          data-diff-line={line.type}
          data-line-picked={picked || undefined}
          className={`${cellClass} ${html === undefined ? tone.text : "text-ink-soft"}`}
          dangerouslySetInnerHTML={{ __html: marked }}
        />
      ) : (
        <span
          data-diff-code={side}
          data-diff-line={line.type}
          data-line-picked={picked || undefined}
          className={`${cellClass} ${tone.text}`}
        >
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
function SplitDiffBody({
  file,
  wrap,
  hunkActions,
}: {
  file: ChangedFile;
  wrap: boolean;
  hunkActions?: HunkActions;
}) {
  const lines = useMemo(() => numberDiffLines(file.diff ?? []), [file]);
  const rows = useMemo(() => splitDiffRows(lines), [lines]);
  let hunkIndex = -1;
  const texts = useMemo(() => lines.map((line) => line.text), [lines]);
  const highlighted = useHighlightedLines(file.path, texts);
  const changes = useMemo(() => intralineRanges(lines), [lines]);
  const selection = useLineSelection(file.diff, canPickLines(file, hunkActions));
  // With tick boxes the number gutters grow just enough for the widest number plus the box.
  const digits = Math.max(2, ...lines.map((line) => String(Math.max(line.oldNumber ?? 0, line.newNumber ?? 0)).length));
  const numberTracks: React.CSSProperties | undefined = selection
    ? {
        gridTemplateColumns: wrap
          ? `calc(${digits}ch + 29px) minmax(0,1fr) calc(${digits}ch + 29px) minmax(0,1fr)`
          : `calc(${digits}ch + 29px) auto calc(${digits}ch + 29px) auto`,
      }
    : undefined;

  // Wrap mode swaps the max-content auto tracks for fr tracks: both panes take half the pane
  // each and long lines soft-wrap inside. The one shared grid still keeps panes aligned.
  return (
    <div
      style={numberTracks}
      className={`grid ${
        wrap
          ? `min-w-full ${selection ? "" : "grid-cols-[36px_minmax(0,1fr)_36px_minmax(0,1fr)]"}`
          : `w-max min-w-full ${selection ? "" : "grid-cols-[36px_auto_36px_auto]"}`
      }`}
    >
      {groupByHunk(
        rows.map((row) => row.hunk !== null),
        rows.map((row, rowIndex) => {
        if (row.hunk) {
          hunkIndex += 1;
          return (
            <div
              key={rowIndex}
              data-diff-row="hunk"
              className={`col-span-4 ${hunkActions ? `flex items-center gap-2 ${PINNED_HUNK}` : "block bg-primary/[0.07]"} ${wrap ? "whitespace-pre-wrap" : "whitespace-pre"} px-3.5 py-1 font-semibold text-primary-ink`}
            >
              {hunkActions ? <span className="min-w-0">{row.hunk.text}</span> : row.hunk.text}
              <HunkHint text={hunkHint(file, hunkActions, selection, hunkIndex, row.hunk.text)} />
              {hunkActions && (
                <HunkButtons
                  path={file.path}
                  index={hunkIndex}
                  header={row.hunk.text}
                  actions={hunkActions}
                  picked={selection?.pickedIn(hunkIndex)}
                  counts={selection?.countsIn(hunkIndex)}
                  onClear={selection ? clearHunk(selection, hunkIndex) : undefined}
                />
              )}
            </div>
          );
        }
        return (
          <Fragment key={rowIndex}>
            <SplitCells
              line={row.old}
              side="old"
              html={row.oldIndex >= 0 ? highlighted?.[row.oldIndex] : undefined}
              ranges={changes.get(row.oldIndex)}
              wrap={wrap}
              pick={row.old ? pickProps(selection, row.oldIndex, changeGroup(selection, row), pickLabel(row.old)) : undefined}
              picked={rowPicked(selection, row)}
            />
            <SplitCells
              line={row.new}
              side="new"
              html={row.newIndex >= 0 ? highlighted?.[row.newIndex] : undefined}
              ranges={changes.get(row.newIndex)}
              wrap={wrap}
              pick={row.new ? pickProps(selection, row.newIndex, changeGroup(selection, row), pickLabel(row.new)) : undefined}
              picked={rowPicked(selection, row)}
            />
          </Fragment>
        );
      }),
        "col-span-4 grid grid-cols-subgrid",
        Boolean(hunkActions),
      )}
    </div>
  );
}

/** Path line, as "old → new" when the file moved, so a rename reads at a glance. */
function FilePath({ file }: { file: ChangedFile }) {
  if (!file.oldPath) {
    return (
      <span
        className={`min-w-0 truncate font-mono text-[11.5px] font-medium ${fileNameTone(file.status)}`}
        title={fileTitle(file)}
      >
        {file.path}
      </span>
    );
  }
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 font-mono text-[11.5px]"
      title={fileTitle(file)}
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

/** One file's header: path, status, line counts. Sticky, for the stacked "all files" view.
 *  The band is a tinted strip in light theme: white-on-white left the boundary between two
 *  files invisible, so the only cue was a 8%-ink hairline. */
function FileHeader({ file }: { file: ChangedFile }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-hairline bg-sheet-band px-3.5 py-2 backdrop-blur-md">
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
          className={`h-5.5 rounded-full px-2.5 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 ${
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
          className={`h-5.5 rounded-full px-2.5 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 ${
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
      className={`grid size-6 shrink-0 place-items-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 ${
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
  onPatchNeeded,
  hunkActions,
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
  // section into view. jsdom has no scrollIntoView, so the call is guarded, not assumed. The
  // section scrolls flush to the top on purpose (no scroll-margin): a gap there left the
  // PREVIOUS file's sticky header pinned over the seam, so the jump looked like it landed one
  // file too high.
  const sections = useRef(new Map<string, HTMLElement>());
  const target = file?.path ?? null;
  useEffect(() => {
    if (scope !== "all" || !target) return;
    const node = sections.current.get(target);
    if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "start" });
  }, [scope, target, files]);

  // Patches are lazy: the selected file asks immediately, stacked sections on scroll-in
  // (240px margin). Image files skip (ImageDiff fetches its blobs); without IntersectionObserver
  // the stacked scope loads everything at once.
  const listed = useMemo(() => new Map(files.map((item) => [item.path, item])), [files]);
  useEffect(() => {
    if (!onPatchNeeded) return;
    if (scope === "file") {
      const selected = file;
      if (selected && selected.diff === null && !isImageFile(selected.path)) {
        onPatchNeeded(selected.path);
      }
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      for (const item of files) {
        if (item.diff === null && !isImageFile(item.path)) onPatchNeeded(item.path);
      }
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const path = entry.target.getAttribute("data-diff-file");
          const item = path ? listed.get(path) : undefined;
          if (item && item.diff === null && !isImageFile(item.path)) onPatchNeeded(item.path);
        }
      },
      { rootMargin: "240px" }, // Start reading slightly before the section scrolls in.
    );
    for (const node of sections.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [scope, file, files, listed, onPatchNeeded]);

  return (
    <div data-diff data-syntax={scheme} className="flex min-h-0 min-w-0 flex-col bg-sheet">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-hairline bg-sheet-band px-3.5 py-2">
        {scope === "all" ? (
          <span className="min-w-0 truncate text-[11.5px] font-medium text-ink">
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
        {hunkActions && (
          <span
            data-diff-side={hunkActions.side}
            className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10.5px] font-semibold text-primary-ink"
          >
            {hunkActions.side === "staged" ? "Staged" : "Working tree"}
          </span>
        )}
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
          <div
            style={{ "--diff-sticky-top": "36px" } as React.CSSProperties}
            className="min-h-0 flex-1 overflow-auto bg-sheet pb-3 font-mono text-[12px] leading-[1.6]"
          >
            {files.map((item) => (
              <section
                key={item.path}
                data-diff-file={item.path}
                ref={(node) => {
                  if (node) sections.current.set(item.path, node);
                  else sections.current.delete(item.path);
                }}
              >
                <FileHeader file={item} />
                {/* Unwrapped, each file scrolls sideways on its own; the header stays outside. */}
                <div className={wrap ? "pt-1" : "overflow-x-auto pt-1"}>
                  <DiffSection
                    file={item}
                    layout={layout}
                    wrap={wrap}
                    repoPath={repoPath}
                    commitHash={commitHash}
                    hunkActions={hunkActions}
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
              hunkActions={hunkActions}
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
