export type ConflictChoice = "ours" | "theirs" | "both";

export interface ConflictBlock {
  kind: "conflict";
  /** Position among the file's blocks; `applyChoice` addresses a block by it. */
  index: number;
  ours: string[];
  theirs: string[];
  /** File line numbers (1-based, markers counted) of the first current / incoming line. */
  oursStart: number;
  theirsStart: number;
  /** The text after `<<<<<<<` — `HEAD` for the checked-out side. */
  oursLabel: string;
  /** The text after `>>>>>>>` — the branch (or commit) being merged in. */
  theirsLabel: string;
}

export interface TextSegment {
  kind: "text";
  lines: string[];
  /** File line number (1-based) of the first line. */
  start: number;
}

export type ConflictSegment = TextSegment | ConflictBlock;

interface Span {
  start: number;
  sep: number;
  end: number;
  base: number | null;
}

const isStart = (line: string) => line.startsWith("<<<<<<<");
const isEnd = (line: string) => line.startsWith(">>>>>>>");
const isSep = (line: string) => line.replace(/\r$/, "") === "=======";
const isBase = (line: string) => line.startsWith("|||||||");
const label = (line: string, marker: string) => line.slice(marker.length).replace(/\r$/, "").trim();

/** Lines without the final newline (kept apart so a rewrite restores it). */
function split(text: string): { lines: string[]; trailing: boolean } {
  const lines = text.split("\n");
  const trailing = lines.length > 1 && lines[lines.length - 1] === "";
  if (trailing) lines.pop();
  return { lines, trailing };
}

/** Complete `<<<<<<<` … `=======` … `>>>>>>>` runs; an unterminated marker stays plain text. */
function findSpans(lines: string[]): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isStart(lines[i])) {
      i++;
      continue;
    }
    let base: number | null = null;
    let sep = -1;
    let end = -1;
    for (let j = i + 1; j < lines.length && end < 0; j++) {
      if (isStart(lines[j])) break;
      if (sep < 0 && base === null && isBase(lines[j])) base = j;
      else if (sep < 0 && isSep(lines[j])) sep = j;
      else if (sep >= 0 && isEnd(lines[j])) end = j;
    }
    if (sep < 0 || end < 0) {
      i++;
      continue;
    }
    spans.push({ start: i, sep, end, base });
    i = end + 1;
  }
  return spans;
}

/** The file as alternating plain stretches and conflict blocks, in file order. */
export function parseConflictText(text: string): ConflictSegment[] {
  const { lines } = split(text);
  const segments: ConflictSegment[] = [];
  let cursor = 0;
  findSpans(lines).forEach((span, index) => {
    if (span.start > cursor) segments.push({ kind: "text", lines: lines.slice(cursor, span.start), start: cursor + 1 });
    segments.push({
      kind: "conflict",
      index,
      ours: lines.slice(span.start + 1, span.base ?? span.sep),
      theirs: lines.slice(span.sep + 1, span.end),
      oursStart: span.start + 2,
      theirsStart: span.sep + 2,
      oursLabel: label(lines[span.start], "<<<<<<<"),
      theirsLabel: label(lines[span.end], ">>>>>>>"),
    });
    cursor = span.end + 1;
  });
  if (cursor < lines.length) segments.push({ kind: "text", lines: lines.slice(cursor), start: cursor + 1 });
  return segments;
}

/** The file with block `index` replaced by the chosen side(s); every other block is untouched. */
export function applyChoice(text: string, index: number, choice: ConflictChoice): string {
  const { lines, trailing } = split(text);
  const span = findSpans(lines)[index];
  if (!span) return text;
  const ours = lines.slice(span.start + 1, span.base ?? span.sep);
  const theirs = lines.slice(span.sep + 1, span.end);
  const kept = choice === "ours" ? ours : choice === "theirs" ? theirs : [...ours, ...theirs];
  const next = [...lines.slice(0, span.start), ...kept, ...lines.slice(span.end + 1)];
  return next.join("\n") + (trailing ? "\n" : "");
}
