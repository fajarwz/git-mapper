import type { ChangedFile } from "../types";
import { STATUS_LABELS, numberDiffLines } from "../lib/format";

interface DiffViewerProps {
  file: ChangedFile | null;
}

const PREFIX = {
  add: "+",
  remove: "-",
  context: " ",
} as const;

const LINE_TONES = {
  add: { row: "bg-success/10", text: "text-success-ink" },
  remove: { row: "bg-danger/10", text: "text-danger-ink" },
  context: { row: "", text: "text-ink-soft" },
} as const;

export function DiffViewer({ file }: DiffViewerProps) {
  if (!file) {
    return (
      <div data-diff className="flex min-h-0 min-w-0 flex-col bg-sheet">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-rule px-3.5 py-2">
          <span className="truncate font-mono text-[11.5px] font-medium text-ink">Diff</span>
        </div>
        <p className="m-0 p-4 text-[12px] text-ink-dim">Select a changed file to see its diff.</p>
      </div>
    );
  }

  const lines = numberDiffLines(file.diff);

  return (
    <div data-diff className="flex min-h-0 min-w-0 flex-col bg-sheet">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-rule px-3.5 py-2">
        <span className="min-w-0 truncate font-mono text-[11.5px] font-medium text-ink" title={file.path}>
          {file.path}
        </span>
        <span className="shrink-0 rounded-full bg-sheet-strong px-2 py-0.5 text-[10.5px] font-semibold text-ink-dim">
          {STATUS_LABELS[file.status]}
        </span>
        <span className="ml-auto flex gap-2 font-mono text-[11px] font-semibold">
          <span className="text-success-ink">+{file.additions}</span>
          <span className="text-danger-ink">−{file.deletions}</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-sheet pb-3 pt-1 font-mono text-[12px] leading-[1.6]">
        {lines.map((line, index) => {
          if (line.type === "hunk") {
            return (
              <div
                key={index}
                data-diff-line="hunk"
                className="block w-full whitespace-pre bg-primary/[0.07] px-3.5 py-1 font-semibold text-primary-ink"
              >
                {line.text}
              </div>
            );
          }

          const tone = LINE_TONES[line.type];

          return (
            <div
              key={index}
              data-diff-line={line.type}
              className={`grid w-max min-w-full grid-cols-[44px_44px_14px_auto] ${tone.row}`}
            >
              <span className="select-none border-r border-rule pr-2 text-right text-ink-dim">
                {line.oldNumber ?? ""}
              </span>
              <span className="select-none border-r border-rule pr-2 text-right text-ink-dim">
                {line.newNumber ?? ""}
              </span>
              <span className={`select-none text-center ${tone.text}`}>{PREFIX[line.type]}</span>
              <span className={`whitespace-pre pr-[18px] ${tone.text}`}>{line.text || " "}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
