import { useEffect, useMemo, useState } from "react";
import type { ChangedFile } from "../types";
import { STATUS_LABELS, numberDiffLines } from "../lib/format";
import { highlightSync, languageForPath, loadHighlighter, type SyntaxScheme } from "../lib/highlight";

interface DiffViewerProps {
  file: ChangedFile | null;
  /** Which syntax palette the tokens use (see index.css `data-syntax` blocks). Default: app. */
  scheme?: SyntaxScheme;
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

export function DiffViewer({ file, scheme = "app" }: DiffViewerProps) {
  const lines = useMemo(() => (file ? numberDiffLines(file.diff) : []), [file]);

  // Highlighted HTML per line, filled once the file's grammar has loaded. Rows render plain
  // until then, and a file whose language we do not know just stays plain forever.
  const [highlighted, setHighlighted] = useState<string[] | null>(null);
  useEffect(() => {
    const language = file ? languageForPath(file.path) : null;
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

  return (
    <div data-diff data-syntax={scheme} className="flex min-h-0 min-w-0 flex-col bg-sheet">
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
          const html = highlighted?.[index];
          // With tokens on, the content span drops the line tone colour: token spans carry the
          // palette, and only untokenized text keeps the soft base. The row tint stays.
          const contentClass = `whitespace-pre pr-[18px] ${html === undefined ? tone.text : "text-ink-soft"}`;

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
              {html !== undefined ? (
                <span className={contentClass} dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <span className={contentClass}>{line.text || " "}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
