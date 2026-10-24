/**
 * Lane layout, newest-first, in the shape git itself draws.
 *
 * `pending` holds the commits that still have a line running down the graph, one entry per lane,
 * left to right. For each commit:
 *
 * - it takes the lane already reserved for it; a commit nothing reserved (a branch tip) opens a
 *   lane on the right, which is what keeps existing lanes from shuffling;
 * - its entry becomes its first parent in the same lane, so a linear run is one straight line;
 * - extra parents (merges) are inserted just to the right of it, the fork git draws as `|\`;
 * - when a commit has no parent its lane closes and every lane to its right shifts one step left;
 * - a commit reserved in several lanes (the parent of several children) keeps the leftmost lane;
 *   the other reservations are dropped, which is the `|/` join.
 *
 * Lanes stay dense: no holes, no "lowest free lane" reuse. Rows keep both lists (`above` before the
 * commit is consumed, `after` once its parents are in place) so the renderer can draw every line as
 * a short piece inside one row band: straight where a lane continues, a small bend where a lane is
 * forked, joined or shifted. Nothing is ever drawn across several rows, which is what makes forks
 * and joins land on the commit that causes them.
 */
export const MAX_LANES = 10;

export interface LaneRow {
  /** Lane contents (hashes) arriving at this row, index = lane. */
  above: string[];
  /** Lane contents leaving this row downwards, index = lane. */
  after: string[];
}

export interface LaneLayout {
  /** Lane index per commit: where its dot sits. */
  lanes: number[];
  rows: LaneRow[];
  /** Lanes actually needed, for the SVG width. */
  laneCount: number;
  /** Colour slot per commit hash, assigned when the branch first opens a lane. */
  colors: Map<string, number>;
}

export function layoutGraph(commits: Array<{ hash: string; parents: string[] }>): LaneLayout {
  const pending: string[] = [];
  const lanes: number[] = [];
  const rows: LaneRow[] = [];
  const colors = new Map<string, number>();
  let laneCount = 1;

  commits.forEach(({ hash, parents }) => {
    // A commit nothing reserved yet is a branch tip: it opens a lane on the right.
    if (!pending.includes(hash)) {
      pending.push(hash);
      if (!colors.has(hash)) colors.set(hash, pending.length - 1);
    }
    const lane = pending.indexOf(hash);
    const above = pending.slice();

    if (parents.length > 0) {
      pending[lane] = parents[0];
    } else {
      pending.splice(lane, 1); // root: the lane ends here
    }

    // Extra parents fork into lanes just to the right of this one.
    for (const parent of parents.slice(1)) {
      if (pending.includes(parent)) continue;
      pending.splice(Math.min(lane + 1, pending.length), 0, parent);
      if (!colors.has(parent)) colors.set(parent, Math.min(lane + 1, pending.length - 1));
    }

    // Another child may also have reserved this commit further right: that reservation ends here.
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (index !== lane && pending[index] === hash) pending.splice(index, 1);
    }

    laneCount = Math.max(laneCount, above.length, pending.length);
    lanes.push(lane);
    rows.push({ above, after: pending.slice() });
  });

  return { lanes, rows, laneCount, colors };
}
