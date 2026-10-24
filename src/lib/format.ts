import type { DiffLine, FileStatus } from "../types";

const DATE_PARTS = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "23 Oct 2026 12:09" — absolute commit timestamps, never relative offsets. */
export function formatAbsoluteDate(isoDate: string): string {
  const parts = DATE_PARTS.formatToParts(new Date(isoDate));
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
