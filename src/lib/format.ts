import type { DiffLine, FileStatus } from "../types";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatAbsoluteDate(isoDate: string): string {
  return dateFormatter.format(new Date(isoDate));
}

export function relativeDate(isoDate: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(isoDate)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return dateFormatter.format(new Date(isoDate)).split(",")[0];
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
