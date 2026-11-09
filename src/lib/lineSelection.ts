import type { DiffLine } from "../types";

/** A changed line's address: its hunk, and its place among that hunk's `+`/`-` lines. The
 * backend counts the same way (`trim_hunk`), so context lines never shift an index. */
export interface ChangeSlot {
  hunk: number;
  ordinal: number;
}

/** One entry per diff line: its slot when it is an add/remove, null for context and headers. */
export function changeSlots(lines: DiffLine[]): Array<ChangeSlot | null> {
  let hunk = -1;
  let ordinal = 0;
  return lines.map((line) => {
    if (line.type === "hunk") {
      hunk += 1;
      ordinal = 0;
      return null;
    }
    if (line.type === "context" || hunk < 0) return null;
    const slot = { hunk, ordinal };
    ordinal += 1;
    return slot;
  });
}

/** One fingerprint per hunk (header plus every line): picks survive a reload only while the
 * hunk they were made in reads exactly the same. */
export function hunkSignatures(lines: DiffLine[]): string[] {
  const signatures: string[] = [];
  for (const line of lines) {
    if (line.type === "hunk") signatures.push("");
    if (signatures.length > 0) signatures[signatures.length - 1] += `${line.type[0]}${line.text}\n`;
  }
  return signatures;
}
