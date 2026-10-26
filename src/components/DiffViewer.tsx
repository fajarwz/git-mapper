import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangedFile } from "../types";
import { STATUS_LABELS, numberDiffLines } from "../lib/format";
import { highlightSync, languageForPath, loadHighlighter, type SyntaxScheme } from "../lib/highlight";

/**
 * Which files the diff pane shows. "file" is the classic one-file-at-a-time view; "all" stacks
 * every changed file in a single scroll (GitHub's "Files changed"), so reading a whole commit
 * never needs a click per file. The choice is persisted with the rest of the panel state.
 */
export type DiffScope = "file" | "all";

interface DiffViewerProps {
  files: ChangedFile[];
  /** The file selected in the list. In "all" scope it only says which section to scroll to. */
  file: ChangedFile | null;
  scope: DiffScope;
  onScopeChange: (scope: DiffScope) => void;
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

/**
 * One file's diff lines, with its own lazy grammar load. Mounted per file so the highlighting
 * follows that file's language instead of whichever file was selected before.
 */
function DiffBody({ file }: { file: ChangedFile }) {
  const lines = useMemo(() => numberDiffLines(file.diff), [file]);

  // Highlighted HTML per line, filled once the file's grammar has loaded. Rows render plain
  // until then, and a file whose language we do not know just stays plain forever.
  const [highlighted, setHighlighted] = useState<string[] | null>(null);
  useEffect(() => {
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

  return (
    <>
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
    </>
  );
}

/** One file's header: path, status, line counts. Sticky, for the stacked "all files" view. */
function FileHeader({ file }: { file: ChangedFile }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-rule bg-sheet-strong px-3.5 py-2 backdrop-blur-md">
      <span className="min-w-0 truncate font-mono text-[11.5px] font-medium text-ink" title={file.path}>
        {file.path}
      </span>
      <span className="shrink-0 rounded-full bg-sheet-strong px-2 py-0.5 text-[10.5px] font-semibold text-ink-dim">
        {STATUS_LABELS[file.status]}
      </span>
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

export function DiffViewer({ files, file, scope, onScopeChange, scheme = "app" }: DiffViewerProps) {
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
        ) : (
          <span className="min-w-0 truncate font-mono text-[11.5px] font-medium text-ink" title={file?.path}>
            {file ? file.path : "Diff"}
          </span>
        )}
        {scope === "file" && file && (
          <span className="shrink-0 rounded-full bg-sheet-strong px-2 py-0.5 text-[10.5px] font-semibold text-ink-dim">
            {STATUS_LABELS[file.status]}
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
                  <DiffBody file={item} />
                </div>
              </section>
            ))}
          </div>
        )
      ) : (
        // One file at a time: the panel header above IS this file's header.
        <div className="min-h-0 flex-1 overflow-auto bg-sheet pb-3 pt-1 font-mono text-[12px] leading-[1.6]">
          {file ? (
            <DiffBody file={file} />
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
