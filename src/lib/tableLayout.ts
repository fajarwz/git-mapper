/** Shared sizing for the commit table so the header and rows cannot drift apart. */
export const COMMIT_HEADER_GRID =
  "grid-cols-[var(--graph-width)_var(--col-message)_var(--col-author)_var(--col-date)_var(--col-hash)_var(--col-spacer)]";

export const COMMIT_ROW_GRID =
  "grid-cols-[var(--col-message)_var(--col-author)_var(--col-date)_var(--col-hash)_var(--col-spacer)]";

export const DEFAULT_AUTHOR_WIDTH = 132;
export const DEFAULT_DATE_WIDTH = 104;
export const HASH_WIDTH = 74;

export const MIN_MESSAGE_WIDTH = 160;
export const MAX_MESSAGE_WIDTH = 1200;
export const MIN_AUTHOR_WIDTH = 72;
export const MAX_AUTHOR_WIDTH = 280;
export const MIN_DATE_WIDTH = 72;
export const MAX_DATE_WIDTH = 220;

export const MAX_GRAPH_EXTRA = 280;

export const DEFAULT_SIDEBAR_WIDTH = 360;
export const MIN_SIDEBAR_WIDTH = 260;
export const MAX_SIDEBAR_WIDTH = 640;

export const DEFAULT_DETAILS_HEIGHT = 360;
export const MIN_DETAILS_HEIGHT = 160;
export const MAX_DETAILS_HEIGHT = 760;
