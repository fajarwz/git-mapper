import { parseDiffSections } from "../lib/gitDiffParser";
import type { ConflictSnapshot } from "../data/gitLoader";
import type { DiffLine } from "../types";

export interface ConflictFile {
  path: string;
  snapshot: ConflictSnapshot;
}

const LINE_TONES: Record<DiffLine["type"], string> = {
  add: "bg-success/10 text-success-ink",
  remove: "bg-danger/10 text-danger-ink",
  context: "text-ink-soft",
  hunk: "bg-warning/15 text-warning-ink",
};

const SECTION_LABEL = {
  heading: "px-3.5 py-1.5 text-[11px] font-semibold",
  row: "grid grid-cols-[1.25rem_minmax(0,1fr)] gap-1 px-3.5 font-mono text-[11.5px] leading-tracked py-px",
} as const;

/**
 * The merge conflict panes: ours and theirs, each patched against the shared base, stacked in
 * one scroll. Read-only — the decision (take a side) rides the buttons above each section,
 * flat and always visible; a side with no index stage (delete/modify pairs) renders absent.
 */
export function ConflictViewer({
  conflict,
  onResolve,
}: {
  conflict: ConflictFile;
  onResolve: (side: "ours" | "theirs") => void;
}) {
  const sides = [
    {
      side: "ours" as const,
      title: "Ours (HEAD)",
      note: "the checked-out side",
      patch: conflict.snapshot.oursPatch,
      resolveLabel: "Take ours",
      tone: "text-success-ink",
    },
    {
      side: "theirs" as const,
      title: "Theirs (MERGE_HEAD)",
      note: "the branch being merged in",
      patch: conflict.snapshot.theirsPatch,
      resolveLabel: "Take theirs",
      tone: "text-primary-ink",
    },
  ];

  return (
    <section
      data-conflict-view
      aria-label="Merge conflict"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-rule bg-sheet-band px-3.5 py-2 text-[11.5px] text-ink-dim">
        <span className="shrink-0 font-semibold text-ink">{conflict.path}</span>
        <span className="shrink-0">is conflicted between both sides — a side has its patch</span>
      </div>
      {sides.map((entry) => {
        const lines = parseDiffSections(entry.patch ?? "").get(conflict.path) ?? [];
        return (
          <div key={entry.side} className="flex flex-col">
            <div className={SECTION_LABEL.heading}>
              <span className={`${entry.tone}`}>{entry.title}</span>{" "}
              <span className="font-normal text-ink-dim">{entry.note}</span>
            </div>
            <div className="flex items-center gap-2 px-3.5 pb-1.5">
              <button
                type="button"
                onClick={() => onResolve(entry.side)}
                title={`Stage ${entry.title}'s copy of ${conflict.path}`}
                className="rounded-lg border border-hairline bg-glass-soft px-2.5 py-1 text-[11.5px] font-semibold text-ink transition-colors hover:bg-hover-glass focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                {entry.resolveLabel}
              </button>
              {lines.length === 0 && (
                <span className="text-[11.5px] text-ink-dim">
                  No staged copy — {entry.side === "ours" ? "our" : "their"} side had deleted it.
                </span>
              )}
            </div>
            <div className="border-t border-rule">
              {lines.map((line, index) => (
                <div
                  key={index}
                  className={`${SECTION_LABEL.row} ${LINE_TONES[line.type]}`}
                >
                  <span className="text-ink/45">
                    {line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
                  </span>
                  <span className="break-all whitespace-pre-wrap">{line.text}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
