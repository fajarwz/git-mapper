import { useMemo, useRef, useState } from "react";

import { ChevronDownIcon } from "./icons";

import { useHighlightedLines } from "../hooks/useHighlightedLines";
import { numberDiffLines } from "../lib/format";
import { parseDiffSections } from "../lib/gitDiffParser";
import { intralineRanges, markedLine } from "../lib/intraline";

import {
  applyChoice,
  parseConflictText,
  type ConflictBlock,
  type ConflictChoice,
} from "../lib/conflictMarkers";
import type { ConflictSnapshot } from "../data/gitLoader";
import type { SyntaxScheme } from "../lib/highlight";

export interface ConflictFile {
  path: string;
  snapshot: ConflictSnapshot;
}

// Current = violet, incoming = amber: the same two hues name the side on its band, its lines
// and its button, and neither is the diff's green/red, which would read as add/remove.
const SIDE = {
  ours: {
    chip: "bg-primary text-surface",
    band: "border-t-2 border-primary/60 bg-primary/15",
    row: "bg-primary/[0.12]",
    button: "border-primary/40 bg-primary/10 text-primary-ink hover:bg-primary/20",
  },
  theirs: {
    chip: "bg-warning text-surface",
    band: "border-t-2 border-warning/70 bg-warning/20",
    row: "bg-warning/[0.16]",
    button: "border-warning/50 bg-warning/15 text-warning-ink hover:bg-warning/25",
  },
} as const;

// The same gutter as the diff pane: a muted number column ruled off from the code.
const GUTTER = "select-none border-r border-rule pr-2 text-right text-ink/45";
const ROW = "grid grid-cols-[44px_minmax(0,1fr)] font-mono text-[11.5px] leading-tracked";
const NAV_BUTTON =
  "grid size-6 place-items-center rounded-full border border-hairline bg-glass-soft text-ink-dim transition-colors hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-40 disabled:hover:bg-glass-soft disabled:hover:text-ink-dim";
const BUTTON =
  "shrink-0 rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50";

function Chip({ side, children }: { side: "ours" | "theirs"; children: string }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-px text-[10.5px] font-bold uppercase tracking-wide ${SIDE[side].chip}`}
    >
      {children}
    </span>
  );
}

/** Numbered code rows; `html` carries the highlighted tokens once the grammar has loaded. */
function Lines({
  lines,
  start,
  html,
  tone,
}: {
  lines: string[];
  start: number;
  html?: string[] | null;
  tone: string;
}) {
  return (
    <>
      {lines.map((text, index) => {
        const tokens = html?.[index];
        return (
          <div key={index} className={`${ROW} ${tone}`}>
            <span data-line-number className={GUTTER}>
              {start + index}
            </span>
            {tokens !== undefined ? (
              <span
                className="whitespace-pre-wrap wrap-break-word pr-[18px] pl-2 text-ink-soft"
                dangerouslySetInnerHTML={{ __html: tokens }}
              />
            ) : (
              <span className="whitespace-pre-wrap wrap-break-word pr-[18px] pl-2 text-ink-soft">
                {text.replace(/\r$/, "") || " "}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

function Block({
  block,
  html,
  current,
  snapshotIncoming,
  disabled,
  onChoose,
}: {
  block: ConflictBlock;
  /** Highlighted rows for `[...ours, ...theirs]`, when ready. */
  html: string[] | null;
  current: string;
  /** The merged branch from the snapshot, for a `>>>>>>>` line git left unlabeled. */
  snapshotIncoming: string;
  disabled: boolean;
  onChoose: (choice: ConflictChoice) => void;
}) {
  const incoming = block.theirsLabel || snapshotIncoming || "incoming";
  const currentName = block.oursLabel === "HEAD" || block.oursLabel === "" ? current : block.oursLabel;
  return (
    <div data-conflict-block className="my-1.5 flex scroll-mt-10 flex-col">
      <div className={`flex items-center gap-2 px-3.5 py-1.5 ${SIDE.ours.band}`}>
        <Chip side="ours">current</Chip>
        <span className="min-w-0 truncate text-[11.5px] font-semibold text-ink" title={currentName}>
          {currentName}
        </span>
        <span className="hidden shrink-0 text-[11.5px] text-ink-dim sm:inline">
          the branch you are on
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChoose("ours")}
          title={`Replace this conflict with the lines from ${currentName}; ${incoming}'s lines are dropped`}
          className={`ml-auto ${BUTTON} ${SIDE.ours.button}`}
        >
          Keep current
        </button>
      </div>
      <Lines lines={block.ours} start={block.oursStart} html={html?.slice(0, block.ours.length)} tone={SIDE.ours.row} />
      <div className="flex items-center gap-2 border-y border-rule bg-sheet-band px-3.5 py-1">
        <span className="text-[11.5px] text-ink-dim">or combine them</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChoose("both")}
          title={`Keep both: ${currentName}'s lines first, then ${incoming}'s`}
          className={`ml-auto ${BUTTON} border-hairline bg-glass-soft text-ink hover:bg-hover-glass`}
        >
          Keep both
        </button>
      </div>
      <Lines lines={block.theirs} start={block.theirsStart} html={html?.slice(block.ours.length)} tone={SIDE.theirs.row} />
      <div className={`flex items-center gap-2 px-3.5 py-1.5 ${SIDE.theirs.band}`}>
        <Chip side="theirs">incoming</Chip>
        <span className="min-w-0 truncate text-[11.5px] font-semibold text-ink" title={incoming}>
          {incoming}
        </span>
        <span className="hidden shrink-0 text-[11.5px] text-ink-dim sm:inline">
          the branch being merged in
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChoose("theirs")}
          title={`Replace this conflict with the lines from ${incoming}; ${currentName}'s lines are dropped`}
          className={`ml-auto ${BUTTON} ${SIDE.theirs.button}`}
        >
          Keep incoming
        </button>
      </div>
    </div>
  );
}

const PATCH_TONES = {
  add: { row: "bg-success/10", gutter: "bg-success/30", mark: "+" },
  remove: { row: "bg-danger/10", gutter: "bg-danger/30", mark: "-" },
  context: { row: "", gutter: "", mark: " " },
  hunk: { row: "", gutter: "", mark: "" },
} as const;

/** One side's patch against the shared base — what that side did to the file. */
function PatchRows({ patch, path }: { patch: string; path: string }) {
  const lines = useMemo(
    () => numberDiffLines(parseDiffSections(patch).get(path) ?? []),
    [patch, path],
  );
  const texts = useMemo(() => lines.map((line) => line.text), [lines]);
  const highlighted = useHighlightedLines(path, texts);
  const changes = useMemo(() => intralineRanges(lines), [lines]);
  return (
    <>
      {lines.map((line, index) => {
        if (line.type === "hunk") {
          return (
            <div
              key={index}
              className="bg-primary/[0.07] px-3.5 py-1 font-mono text-[11.5px] font-semibold text-primary-ink"
            >
              {line.text}
            </div>
          );
        }
        const tone = PATCH_TONES[line.type];
        const tokens = markedLine(line, highlighted?.[index], changes.get(index));
        return (
          <div
            key={index}
            data-patch-line={line.type}
            className={`grid grid-cols-[44px_44px_14px_minmax(0,1fr)] font-mono text-[11.5px] leading-tracked ${tone.row}`}
          >
            <span className={`${GUTTER} ${line.type === "remove" ? tone.gutter : ""}`}>
              {line.oldNumber ?? ""}
            </span>
            <span className={`${GUTTER} ${line.type === "add" ? tone.gutter : ""}`}>
              {line.newNumber ?? ""}
            </span>
            <span className="select-none text-center text-ink-dim">{tone.mark}</span>
            {tokens !== undefined ? (
              <span
                className="whitespace-pre-wrap wrap-break-word pr-[18px] text-ink-soft"
                dangerouslySetInnerHTML={{ __html: tokens }}
              />
            ) : (
              <span className="whitespace-pre-wrap wrap-break-word pr-[18px] text-ink-soft">
                {line.text || " "}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Whole-file decision for a conflict with no markers to edit: a deletion, or a binary file. */
function WholeFile({
  conflict,
  current,
  onResolve,
}: {
  conflict: ConflictFile;
  current: string;
  onResolve: (side: "ours" | "theirs") => void;
}) {
  const { oursPatch, theirsPatch } = conflict.snapshot;
  const incoming = conflict.snapshot.incoming || "the merged branch";
  const oursGone = oursPatch === "";
  const theirsGone = theirsPatch === "" && !oursGone;
  const story = oursGone
    ? `The current branch (${current}) deleted this file, while the incoming branch (${incoming}) changed it.`
    : theirsGone
      ? `The incoming branch (${incoming}) deleted this file, while the current branch (${current}) changed it.`
      : "Git could not merge this file line by line, so it can only be taken whole.";
  // The side that kept the file is the one with a change to show: what it did to the file.
  const kept = oursGone ? "theirs" : theirsGone ? "ours" : null;
  const keptPatch = kept === "ours" ? oursPatch : kept === "theirs" ? theirsPatch : "";
  const keptName = kept === "ours" ? current : incoming;
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 px-3.5 py-3">
      <p className="m-0 text-[12px] text-ink-soft">{story}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onResolve("ours")}
          title={`Keep the current branch's (${current}) version of ${conflict.path}${oursGone ? " — the file stays deleted" : ""}`}
          className={`${BUTTON} ${SIDE.ours.button}`}
        >
          {oursGone ? "Keep it deleted (current)" : "Keep current version"}
        </button>
        <button
          type="button"
          onClick={() => onResolve("theirs")}
          title={`Keep the incoming branch's version of ${conflict.path}${theirsGone ? " — the file is deleted" : ""}`}
          className={`${BUTTON} ${SIDE.theirs.button}`}
        >
          {theirsGone ? "Accept the deletion (incoming)" : "Keep incoming version"}
        </button>
      </div>
      </div>
      {kept && keptPatch && (
        <>
          <div className={`flex items-center gap-2 px-3.5 py-1.5 ${SIDE[kept].band}`}>
            <Chip side={kept}>{kept === "ours" ? "current" : "incoming"}</Chip>
            <span className="min-w-0 truncate text-[11.5px] font-semibold text-ink" title={keptName}>
              {keptName}
            </span>
            <span className="shrink-0 text-[11.5px] text-ink-dim">
              changed this file — keeping the deletion drops these changes
            </span>
          </div>
          <PatchRows patch={keptPatch} path={conflict.path} />
        </>
      )}
    </div>
  );
}

/**
 * The conflicted file as git left it, one view: plain lines around each conflict block, and
 * the choice sits on the block itself. A click rewrites that block in the file; once the last
 * one is gone the file is staged and leaves the Conflicts list.
 */
export function ConflictViewer({
  conflict,
  currentBranch,
  scheme = "app",
  onResolve,
  onWriteText,
}: {
  conflict: ConflictFile;
  currentBranch: string;
  /** Syntax palette, as in the diff pane (see index.css `data-syntax`). */
  scheme?: SyntaxScheme;
  onResolve: (side: "ours" | "theirs") => void;
  onWriteText: (text: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const text = conflict.snapshot.worktreeText;
  const segments = useMemo(() => parseConflictText(text), [text]);
  const blocks = segments.filter((segment) => segment.kind === "conflict").length;
  // Every shown line in file order, so one grammar pass highlights the lot.
  const texts = useMemo(
    () => segments.flatMap((s) => (s.kind === "text" ? s.lines : [...s.ours, ...s.theirs])),
    [segments],
  );
  const html = useHighlightedLines(conflict.path, texts);
  let offset = 0;
  const current = currentBranch || "current branch";

  // Prev/next walk the blocks; the position follows manual scrolling too, so the label never
  // lies about where you are. A block counts as "current" while its bottom is below the header.
  const sectionRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const position = Math.min(active, Math.max(blocks - 1, 0));
  const blockEls = () =>
    Array.from(sectionRef.current?.querySelectorAll<HTMLElement>("[data-conflict-block]") ?? []);
  function syncActive() {
    const section = sectionRef.current;
    if (!section) return;
    const header = section.firstElementChild as HTMLElement | null;
    const edge = section.getBoundingClientRect().top + (header?.offsetHeight ?? 0) + 1;
    const index = blockEls().findIndex((el) => el.getBoundingClientRect().bottom > edge);
    setActive(index < 0 ? Math.max(blocks - 1, 0) : index);
  }
  function go(delta: number) {
    const els = blockEls();
    const target = Math.min(Math.max(position + delta, 0), els.length - 1);
    els[target]?.scrollIntoView?.({ block: "start" });
    setActive(target);
  }

  async function choose(index: number, choice: ConflictChoice) {
    setBusy(true);
    try {
      await onWriteText(applyChoice(text, index, choice));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      ref={sectionRef}
      data-conflict-view
      data-syntax={scheme}
      aria-label="Merge conflict"
      onScroll={syncActive}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule bg-sheet-band px-3.5 py-2 text-[11.5px] text-ink-dim">
        <span className="font-semibold text-ink">{conflict.path}</span>
        <span>
          {blocks > 0
            ? `${blocks} ${blocks === 1 ? "conflict" : "conflicts"} left — choose what to keep for each.`
            : "Choose which version to keep."}
        </span>
        {blocks > 0 && (
          <span className="ml-auto flex items-center gap-1">
            <span data-conflict-position className="mr-1 tabular-nums">
              Conflict {position + 1} of {blocks}
            </span>
            <button
              type="button"
              aria-label="Previous conflict"
              title="Previous conflict"
              disabled={position === 0}
              onClick={() => go(-1)}
              className={NAV_BUTTON}
            >
              <ChevronDownIcon size={12} className="rotate-180" />
            </button>
            <button
              type="button"
              aria-label="Next conflict"
              title="Next conflict"
              disabled={position >= blocks - 1}
              onClick={() => go(1)}
              className={NAV_BUTTON}
            >
              <ChevronDownIcon size={12} />
            </button>
          </span>
        )}
      </div>
      {blocks === 0 ? (
        <WholeFile conflict={conflict} current={current} onResolve={onResolve} />
      ) : (
        <div className="pb-2">
          {segments.map((segment, slot) => {
            const count = segment.kind === "text" ? segment.lines.length : segment.ours.length + segment.theirs.length;
            const rows = html ? html.slice(offset, offset + count) : null;
            offset += count;
            return segment.kind === "text" ? (
              <Lines key={slot} lines={segment.lines} start={segment.start} html={rows} tone="" />
            ) : (
              <Block
                key={slot}
                block={segment}
                html={rows}
                current={current}
                snapshotIncoming={conflict.snapshot.incoming}
                disabled={busy}
                onChoose={(choice) => void choose(segment.index, choice)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
