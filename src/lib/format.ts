import type { DiffLine, FileStatus } from "../types";

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

// Commit times are shown in the viewer's own timezone, so the default formatter
// is resolved once; a caller that needs a fixed zone (the tests) asks for one.
const LOCAL_DATE_PARTS = new Intl.DateTimeFormat("en-GB", DATE_OPTIONS);

/**
 * "23 Oct 2026 12:09" — absolute commit timestamps, never relative offsets.
 * `timeZone` is an IANA zone; omit it for the machine's local time.
 */
export function formatAbsoluteDate(isoDate: string, timeZone?: string): string {
  const formatter = timeZone
    ? new Intl.DateTimeFormat("en-GB", { ...DATE_OPTIONS, timeZone })
    : LOCAL_DATE_PARTS;
  const parts = formatter.formatToParts(new Date(isoDate));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")} ${get("hour")}:${get("minute")}`;
}

export const STATUS_LABELS: Record<FileStatus, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
};

/**
 * Status badges, GitHub-style: the letter sits on its own hue (green added, amber modified,
 * red deleted, violet renamed) so a scan of the file list reads the change kind at a glance.
 * Tokens only; `.dark` re-points the ink colors without any dark: variants here.
 */
export const STATUS_TONES: Record<FileStatus, string> = {
  added: "bg-success/15 text-success-ink",
  modified: "bg-warning/15 text-warning-ink",
  deleted: "bg-danger/15 text-danger-ink",
  renamed: "bg-primary/15 text-primary-ink",
};

/** Hover text for a file row: its status first, then the full path ("old → new" for a rename). */
export function fileTitle(file: { status: FileStatus; path: string; oldPath?: string | null }): string {
  const where = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
  return `${STATUS_LABELS[file.status]} · ${where}`;
}

const STRUCK = "line-through decoration-danger-ink decoration-[1.5px]";

/** A deleted file's whole path is struck through and dimmed, in the badge's red (as VS Code does). */
export function fileNameTone(status: FileStatus): string {
  return status === "deleted" ? `text-ink-soft ${STRUCK}` : "text-ink";
}

/** The folder part of the same path: muted either way, struck with the name when deleted. */
export function fileDirTone(status: FileStatus): string {
  return status === "deleted" ? `text-ink-dim ${STRUCK}` : "text-ink-dim";
}

export function statusLetter(status: FileStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
  }
}

export interface NumberedDiffLine {
  type: DiffLine["type"];
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

/** Adds gutter line numbers to diff lines, resetting them at each hunk header. */
export function numberDiffLines(lines: DiffLine[]): NumberedDiffLine[] {
  let oldNumber = 0;
  let newNumber = 0;

  return lines.map((line) => {
    if (line.type === "hunk") {
      const header = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line.text);
      if (header) {
        oldNumber = Number(header[1]);
        newNumber = Number(header[2]);
      }
      return { type: line.type, text: line.text };
    }

    if (line.type === "add") {
      return { type: line.type, text: line.text, newNumber: newNumber++ };
    }

    if (line.type === "remove") {
      return { type: line.type, text: line.text, oldNumber: oldNumber++ };
    }

    const numbered = { type: line.type, text: line.text, oldNumber, newNumber };
    oldNumber += 1;
    newNumber += 1;
    return numbered;
  });
}
