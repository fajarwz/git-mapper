/**
 * Lane layout, newest-first, in the shape git itself draws.
 *
 * `pending` holds the commits that still have a line running down the graph, one entry per lane,
 * left to right. Each entry carries the line's **colour** as well as its commit, because a line
 * keeps its hue while it shifts lanes: the lane decides *where* a line is drawn, the slot decides
 * which colour it is. The colour is a palette index (see `lineColor` in graphGeometry), which keeps
 * this module free of CSS so it can be checked on its own.
 *
 * For each commit:
 *
 * - it takes the lane already reserved for it; a commit nothing reserved (a branch tip) opens a
 *   lane on the right, which is what keeps existing lanes from shuffling;
 * - its entry becomes its first parent in the same lane with the same colour, so a linear run is
 *   one straight line in one hue;
 * - extra parents (merges) are inserted just to the right of it, the fork git draws, and
 *   each one starts a **new** line with its own colour;
 * - when a commit has no parent its lane closes and every lane to its right shifts one step left.
 *   The lines to the right move but keep their colours, which is the point of carrying the colour
 *   in the slot instead of deriving it from the lane index;
 * - a commit is reserved in **one** lane at a time. A second child of the same parent bends into
 *   the line that already exists for it, at the child's own row: that is the `|/` join. Keeping a
 *   lane per reservation drew the same commit as several parallel lines.
 *
 * Lanes stay dense: no holes, no "lowest free lane" reuse. Rows keep both lists (`above` before the
 * commit is consumed, `after` once its parents are in place) so the renderer can draw every line as
 * a short piece inside one row band: straight where a line continues, a small bend where a lane is
 * forked, joined or shifted. Nothing is ever drawn across several rows, which is what makes forks
 * and joins land on the commit that causes them.
 *
 * Colour allocation: a new line takes the palette entry used by the fewest active lines, skipping
 * the colours of the lanes that will sit either side of it, ties going to the lowest index. That is
 * deterministic for identical input, keeps neighbours apart, and never repaints a line already on
 * screen.
 */
export const LINE_COLOR_COUNT = 8;

export interface LaneSlot {
  /** Commit this line is waiting for. */
  hash: string;
  /** Palette index of the line, carried forward while the line continues. */
  color: number;
}

export interface LaneRow {
  /** Lines arriving at this row, index = lane. */
  above: LaneSlot[];
  /** Lines leaving this row downwards, index = lane. */
  after: LaneSlot[];
  /** True when nothing reserved this commit: it opens a lane, so it has no line above it. */
  tip: boolean;
  /**
   * Lane in `after` where this commit's first parent already had a line, so this row's line bends
   * into it instead of continuing in place. null when the line carries on in its own lane.
   */
  join: number | null;
}

export interface LaneLayout {
  /** Lane index per commit: where its dot sits. */
  lanes: number[];
  /** Palette index per commit: the colour of the line its dot belongs to. */
  colors: number[];
  rows: LaneRow[];
  /** Lanes actually needed, for the SVG width. */
  laneCount: number;
}

/** Least-used palette entry around `at`, neighbours' colours skipped, ties to the lowest index. */
function pickColor(slots: LaneSlot[], at: number): number {
  const uses = new Array<number>(LINE_COLOR_COUNT).fill(0);
  for (const slot of slots) {
    uses[slot.color] += 1;
  }

  const neighbours = new Set<number>();
  for (const index of [at - 1, at]) {
    const slot = slots[index];
    if (slot) neighbours.add(slot.color);
  }

  let best = -1;
  for (let color = 0; color < LINE_COLOR_COUNT; color += 1) {
    if (neighbours.has(color)) continue;
    if (best === -1 || uses[color] < uses[best]) best = color;
  }
  if (best !== -1) return best;

  // Every entry sits next to the new line (only possible with the whole palette active): fall
  // back to the least-used entry rather than repainting a line or going off-palette.
  best = 0;
  for (let color = 1; color < LINE_COLOR_COUNT; color += 1) {
    if (uses[color] < uses[best]) best = color;
  }
  return best;
}

export function layoutGraph(commits: Array<{ hash: string; parents: string[] }>): LaneLayout {
  const pending: LaneSlot[] = [];
  const lanes: number[] = [];
  const colors: number[] = [];
  const rows: LaneRow[] = [];
  let laneCount = 1;

  commits.forEach(({ hash, parents }) => {
    // A commit nothing reserved yet is a branch tip: it opens a lane on the right. A tip that
    // points at a commit already on screen is the same line, so it takes that line's colour.
    let lane = pending.findIndex((slot) => slot.hash === hash);
    const tip = lane === -1;
    if (tip) {
      const parentLine = parents[0] ? pending.find((slot) => slot.hash === parents[0]) : undefined;
      lane = pending.length;
      pending.push({ hash, color: parentLine ? parentLine.color : pickColor(pending, lane) });
    }

    // Snapshot before any mutation: this row's geometry must not change under it.
    const above = pending.map((slot) => ({ ...slot }));
    const color = pending[lane].color;

    let join: number | null = null;
    if (parents.length > 0) {
      const first = parents[0];
      const reserved = pending.findIndex((slot, index) => index !== lane && slot.hash === first);
      if (reserved === -1) {
        // The first parent continues this line, in this lane, with this colour.
        pending[lane] = { hash: first, color };
      } else {
        // Another child already holds a line for that parent. Git keeps ONE line per pending
        // commit and bends every child into it here; reserving a second lane drew the same commit
        // as several parallel lines that fanned into one dot many rows later.
        pending.splice(lane, 1);
      }
    } else {
      pending.splice(lane, 1); // root: the lane ends here
    }

    // Extra parents fork into new lines just to the right of this one.
    for (const parent of parents.slice(1)) {
      if (pending.some((slot) => slot.hash === parent)) continue;
      const at = Math.min(lane + 1, pending.length);
      pending.splice(at, 0, { hash: parent, color: pickColor(pending, at) });
    }

    // Every lane holds a different commit by now: reservations join the existing line above, so a
    // hash can never sit in two lanes and nothing has to be swept here.

    const after = pending.map((slot) => ({ ...slot }));
    if (parents.length > 0) {
      const at = after.findIndex((slot) => slot.hash === parents[0]);
      if (at !== -1 && at !== lane) join = at;
    }

    laneCount = Math.max(laneCount, above.length, pending.length);
    lanes.push(lane);
    colors.push(color);
    rows.push({ above, after, tip, join });
  });

  return { lanes, colors, rows, laneCount };
}
