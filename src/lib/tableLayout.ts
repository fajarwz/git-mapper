/** Shared sizing for the commit table so the header and rows cannot drift apart. The track
 * lists live in `--header-grid` / `--row-grid` (see `commitGrids`), because a hidden column must
 * drop its track and its gap, not just collapse to 0px. */
export const COMMIT_HEADER_GRID = "grid-cols-(--header-grid)";
export const COMMIT_ROW_GRID = "grid-cols-(--row-grid)";

export type ColumnKey = "author" | "date" | "hash";
export type ColumnVisibility = Record<ColumnKey, boolean>;
export const DEFAULT_COLUMNS: ColumnVisibility = { author: true, date: true, hash: true };
export const COLUMN_LABELS: Record<ColumnKey, string> = { author: "Author", date: "Date", hash: "Hash" };

export type ColumnId = "message" | ColumnKey;
export const DEFAULT_ORDER: ColumnId[] = ["message", "author", "date", "hash"];

/** A stored order made safe: unknown ids and repeats dropped, anything missing appended. */
export function normalizeOrder(stored: unknown): ColumnId[] {
  const known = new Set<string>(DEFAULT_ORDER);
  const seen = new Set<string>();
  const kept = (Array.isArray(stored) ? stored : []).filter((id): id is ColumnId => {
    if (typeof id !== "string" || !known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return [...kept, ...DEFAULT_ORDER.filter((id) => !seen.has(id))];
}

const TRACKS: Record<ColumnId, string> = {
  message: "var(--col-message)",
  author: "var(--col-author)",
  date: "var(--col-date)",
  hash: "var(--col-hash)",
};

/** The columns on screen, in order: the commit column is always there. */
export function shownColumns(visible: ColumnVisibility, order: ColumnId[]): ColumnId[] {
  return order.filter((id) => id === "message" || visible[id]);
}

/** Track lists for the header (graph first) and the rows, for the columns currently shown. */
export function commitGrids(
  visible: ColumnVisibility,
  order: ColumnId[] = DEFAULT_ORDER,
): { header: string; row: string } {
  const row = [...shownColumns(visible, order).map((id) => TRACKS[id]), "var(--col-spacer)"].join(" ");
  return { header: `var(--graph-width) ${row}`, row };
}

export const DEFAULT_AUTHOR_WIDTH = 132;
/** Wide enough for a full "23 Oct 2026 12:09" stamp without truncating. */
export const DEFAULT_DATE_WIDTH = 122;
export const HASH_WIDTH = 74;

export const MIN_MESSAGE_WIDTH = 160;
export const MAX_MESSAGE_WIDTH = 1200;
export const MIN_AUTHOR_WIDTH = 72;
export const MAX_AUTHOR_WIDTH = 280;
export const MIN_DATE_WIDTH = 112;
export const MAX_DATE_WIDTH = 220;

export const MAX_GRAPH_EXTRA = 280;
/**
 * Fit-mode cap for the graph gutter, in lanes. The natural width of a busy multi-branch history
 * (dozens of lanes) is enormous; the default column shows the first few lanes and lets the rest
 * overflow (clipped), because the width the layout wants is not a width the panel should give.
 * The splitter still drags it narrower or wider (up to the natural width plus MAX_GRAPH_EXTRA).
 */
export const DEFAULT_GRAPH_LANES = 6;
/**
 * Absolute floor for the graph gutter, below whatever width the lanes currently need. A
 * 30-branch history lays out hundreds of px wide; the gutter must still be draggable down to
 * roughly one lane. The SVG then overflows and is clipped by the column (`overflow-hidden`),
 * so the graph shrinks at the cost of hiding its rightmost lanes.
 */
export const MIN_GRAPH_WIDTH = 28;

export const DEFAULT_SIDEBAR_WIDTH = 360;
export const MIN_SIDEBAR_WIDTH = 260;
export const MAX_SIDEBAR_WIDTH = 640;

export const DEFAULT_DETAILS_HEIGHT = 360;
export const MIN_DETAILS_HEIGHT = 160;
export const MAX_DETAILS_HEIGHT = 760;
