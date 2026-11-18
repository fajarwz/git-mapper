/** A changed stretch of a line, as UTF-16 offsets into its text (end exclusive). */
export type Range = [number, number];

interface Token {
  text: string;
  start: number;
}

/** Words, whitespace runs and single punctuation marks: the unit the diff compares. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/\s+|\w+|[^\w\s]/g)) {
    tokens.push({ text: match[0], start: match.index ?? 0 });
  }
  return tokens;
}

/** Past this many token pairs the exact LCS is skipped and the whole middle is marked. */
const LCS_BUDGET = 40_000;

/** Above this share of changed characters a line pair is a rewrite: the row tint says it all. */
const REWRITE_SHARE = 0.8;

/** Merges touching ranges and ranges separated only by whitespace in `text`. */
function mergeRanges(ranges: Range[], text: string): Range[] {
  const merged: Range[] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && text.slice(last[1], start).trim() === "") last[1] = end;
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * Which parts of two paired lines changed, GitHub-style. Common head and tail tokens are
 * trimmed, the middle is matched by longest common subsequence. Returns null when nothing
 * differs or when the lines are mostly rewritten (marking nearly everything is noise).
 */
export function changedRanges(
  oldText: string,
  newText: string,
): { old: Range[]; new: Range[] } | null {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  let head = 0;
  while (head < a.length && head < b.length && a[head].text === b[head].text) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail].text === b[b.length - 1 - tail].text
  ) {
    tail += 1;
  }
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  if (midA.length === 0 && midB.length === 0) return null;

  const keptA = new Set<number>();
  const keptB = new Set<number>();
  if (midA.length * midB.length <= LCS_BUDGET) {
    const width = midB.length + 1;
    const table = new Uint16Array((midA.length + 1) * width);
    for (let i = midA.length - 1; i >= 0; i -= 1) {
      for (let j = midB.length - 1; j >= 0; j -= 1) {
        table[i * width + j] =
          midA[i].text === midB[j].text
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i].text === midB[j].text) {
        keptA.add(i);
        keptB.add(j);
        i += 1;
        j += 1;
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i += 1;
      else j += 1;
    }
  }

  const collect = (mid: Token[], kept: Set<number>, text: string): Range[] =>
    mergeRanges(
      mid.flatMap((token, index): Range[] =>
        kept.has(index) ? [] : [[token.start, token.start + token.text.length]],
      ),
      text,
    );
  const oldRanges = collect(midA, keptA, oldText);
  const newRanges = collect(midB, keptB, newText);

  const share = (ranges: Range[], text: string) => {
    const body = text.trim().length;
    const changed = ranges.reduce((sum, [s, e]) => sum + text.slice(s, e).trim().length, 0);
    return body === 0 ? 1 : changed / body;
  };
  if (share(oldRanges, oldText) >= REWRITE_SHARE && share(newRanges, newText) >= REWRITE_SHARE) {
    return null;
  }
  return { old: oldRanges, new: newRanges };
}

interface DiffLike {
  type: string;
  text: string;
}

/**
 * Changed ranges for every paired line of a unified diff, keyed by the line's index. A block of
 * removes followed by adds is paired row by row only when both have the same count — an uneven
 * block means lines were inserted or dropped, and zipping it would compare unrelated lines.
 */
export function intralineRanges(lines: DiffLike[]): Map<number, Range[]> {
  const result = new Map<number, Range[]>();
  let index = 0;
  while (index < lines.length) {
    if (lines[index].type !== "remove" && lines[index].type !== "add") {
      index += 1;
      continue;
    }
    const removes: number[] = [];
    const adds: number[] = [];
    while (index < lines.length && (lines[index].type === "remove" || lines[index].type === "add")) {
      (lines[index].type === "remove" ? removes : adds).push(index);
      index += 1;
    }
    if (removes.length === 0 || removes.length !== adds.length) continue;
    removes.forEach((removed, k) => {
      const added = adds[k];
      const pair = changedRanges(lines[removed].text, lines[added].text);
      if (!pair) return;
      if (pair.old.length > 0) result.set(removed, pair.old);
      if (pair.new.length > 0) result.set(added, pair.new);
    });
  }
  return result;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Stronger tint over the changed words; the row's own wash sits underneath. */
export const MARK_CLASS = {
  add: "bg-success/40 text-inherit rounded-[2px]",
  remove: "bg-danger/40 text-inherit rounded-[2px]",
} as const;

/**
 * Wraps the text offsets in `ranges` with <mark> inside already-escaped (and possibly
 * syntax-highlighted) HTML. Tags are copied through untouched and each mark closes before the
 * next tag, so the nesting stays valid however the token spans fall.
 */
export function markHtml(html: string, ranges: Range[], className: string): string {
  if (ranges.length === 0) return html;
  let out = "";
  let offset = 0;
  let next = 0;
  for (const part of html.split(/(<[^>]*>)/)) {
    if (part.startsWith("<")) {
      out += part;
      continue;
    }
    let open = false;
    for (const unit of part.match(/&(?:#x?[0-9a-fA-F]+|\w+);|[\s\S]/g) ?? []) {
      while (next < ranges.length && offset >= ranges[next][1]) next += 1;
      const inside = next < ranges.length && offset >= ranges[next][0];
      if (inside && !open) out += `<mark class="${className}">`;
      if (!inside && open) out += "</mark>";
      open = inside;
      out += unit;
      offset += 1;
    }
    if (open) out += "</mark>";
  }
  return out;
}

/**
 * The HTML a diff row should inject, or undefined when the row renders as plain text: the
 * highlighted tokens with the changed words marked, or an escaped plain line when only the marks
 * apply.
 */
export function markedLine(
  line: { type: string; text: string },
  html: string | undefined,
  ranges: Range[] | undefined,
): string | undefined {
  if (!ranges || (line.type !== "add" && line.type !== "remove")) return html;
  return markHtml(html ?? escapeHtml(line.text), ranges, MARK_CLASS[line.type]);
}
