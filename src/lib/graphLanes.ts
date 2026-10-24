/**
 * Lane layout: an active-lane sweep over a newest-first commit list, recording every graph piece
 * as it goes.
 *
 * The model is a set of active lanes, one entry per line that is still running: the commit that
 * line is heading for. Lanes are dense, so a freed lane shifts the ones to its right leftwards.
 *
 * Per row:
 *
 * - the commit takes the lane whose line is waiting for it; a commit nothing reserved is a branch
 *   tip and opens a lane on the right, which keeps existing lanes from shuffling. A tip that points
 *   at a commit already on screen is the same line, so it adopts that line's colour;
 * - its first parent continues in the same lane with the same colour, unless that parent already
 *   has a line, in which case this row's line ends and bends into it (the `|/` join);
 * - each extra parent (merge) opens a new line just to the right, with its own colour;
 * - a commit with no parent closes its lane and the lanes to its right shift one step left, keeping
 *   their colours;
 * - a parent outside the loaded list ends its line at this row: nothing is invented for it;
 * - a parent that was already drawn (input not topologically ordered) is recorded as a gap and
 *   skipped, so no edge ever points upward.
 *
 * Every transition is recorded here with its kind and colour, so the renderer draws what the sweep
 * decided instead of re-deriving connections from lane indices.
 *
 * Colour rule: a lane owns its colour, and every piece is drawn in the colour of the lane it ends
 * in. A line that moves to another lane therefore changes hue exactly at that lane, and two
 * neighbouring lanes always differ. Colour is a pure function of the lane (see `laneColor`).
 */
export const LINE_COLOR_COUNT = 8;

/**
 * One line, identified by the commit it is heading for. Colour comes from its lane.
 * `null` is a hole: the line that used to sit there ended at this row.
 */
export type LaneSlot = string | null;

export type TransitionKind =
  /** A running line keeps its lane: a vertical piece through this row. */
  | "continue"
  /** A running line moves to another lane; same line, same colour. */
  | "shift"
  /** A line leaves the dot: its first parent, a merge parent, or a tip joining a line below. */
  | "fork"
  /** Another child's line arrives at this commit dot. */
  | "join";

export interface LaneTransition {
  kind: TransitionKind;
  /** Lane the piece starts in. For `fork` that is the dot lane, for `join` the incoming one. */
  from: number;
  /** Lane the piece ends in. Its colour is this lane's colour. */
  to: number;
  /** Commit the piece points at (`join`: the commit it arrives at). */
  hash: string;
}

/** A parent the layout could not draw a line to, and why. */
export interface LaneGap {
  hash: string;
  /** `unloaded` sits outside the loaded window; `out-of-order` was already drawn above. */
  reason: "unloaded" | "out-of-order";
}

export interface LaneRow {
  /** Lines arriving at this row, index = lane. */
  above: LaneSlot[];
  /** Lines leaving this row downwards, index = lane. */
  after: LaneSlot[];
  /** True when nothing reserved this commit: it opens a lane, so it has no line above it. */
  tip: boolean;
  transitions: LaneTransition[];
  gaps: LaneGap[];
}

export interface LaneLayout {
  /** Lane per commit: where its dot sits, and which colour it carries. */
  lanes: number[];
  rows: LaneRow[];
  /** Lanes needed at the widest row, for the SVG width. */
  laneCount: number;
  /** False when a parent appeared above its child (input was not newest-first topological). */
  ordered: boolean;
}

export function layoutGraph(commits: Array<{ hash: string; parents: string[] }>): LaneLayout {
  const input = new Set(commits.map((commit) => commit.hash));
  const pending: LaneSlot[] = [];
  const lanes: number[] = [];
  const rows: LaneRow[] = [];
  const drawn = new Set<string>();
  let laneCount = 1;
  let ordered = true;

  commits.forEach(({ hash, parents }) => {
    // Defensive only: the same hash twice could not own two dots.
    if (drawn.has(hash)) ordered = false;

    let lane = pending.indexOf(hash);
    const tip = lane === -1;
    if (tip) {
      // Reuse the leftmost hole when a line has ended there, otherwise open a lane on the right.
      const hole = pending.indexOf(null);
      lane = hole === -1 ? pending.length : hole;
      if (hole === -1) pending.push(hash);
      else pending[hole] = hash;
    }

    // Snapshot before any mutation: this row's incoming geometry must not change under it.

    const above = pending.slice();
    const gaps: LaneGap[] = parents
      .filter((parent) => !input.has(parent))
      .map((parent) => ({ hash: parent, reason: "unloaded" as const }));
    // Parents whose line already exists, so the dot connects to it instead of opening a new one.
    const stubs: string[] = [];
    const first = parents[0];

    if (first === undefined) {
      pending.splice(lane, 1); // root: the lane ends here and the lanes right of it close up
    } else if (drawn.has(first)) {
      // The parent is already above this row, so the input is not topological. Never draw a line
      // that points upward: drop the connection and mark the layout unordered.
      ordered = false;
      gaps.push({ hash: first, reason: "out-of-order" });
      pending.splice(lane, 1);
    } else if (pending.some((slot, index) => index !== lane && slot === first)) {
      // Another child already holds a line for that parent: this line ends and bends into it.
      stubs.push(first);
      if (parents.length > 1) {
        // A merge needs the columns on its right to stay where they are. Collapsing here would
        // slide its second parent into the dot's own lane, drawing the branch straight down in the
        // dot's colour, which reads as if the branch never separated.
        pending[lane] = null;
      } else {
        // Nothing else needs the column: close up, as git does at the end of a line.
        pending.splice(lane, 1);
      }
    } else {
      pending[lane] = first;
    }

    for (const parent of parents.slice(1)) {
      if (drawn.has(parent)) {
        ordered = false;
        gaps.push({ hash: parent, reason: "out-of-order" });
        continue;
      }
      if (pending.includes(parent)) {
        stubs.push(parent); // that line already exists: connect to it instead of opening another
        continue;
      }
      const at = Math.min(lane + 1, pending.length);
      pending.splice(at, 0, parent);
    }

    const after = pending.slice();

    // Record the pieces. A hash occupies one lane at most, so a line appearing below is either the
    // same line moving (`continue` / `shift`) or a line that starts at this dot (`fork`).
    const transitions: LaneTransition[] = [];
    after.forEach((slot, to) => {
      if (slot === null) return;
      const from = above.indexOf(slot);
      if (from === -1) {
        transitions.push({ kind: "fork", from: lane, to, hash: slot });
      } else {
        transitions.push({ kind: from === to ? "continue" : "shift", from, to, hash: slot });
      }
    });
    // A parent whose line already runs beside this row: the dot bends into that line.
    for (const hash of stubs) {
      const at = after.indexOf(hash);
      if (at !== -1) {
        transitions.push({ kind: "fork", from: lane, to: at, hash });
      }
    }
    above.forEach((slot, from) => {
      if (slot === null || after.includes(slot)) return;
      if (tip && from === lane) return; // a tip has nothing above its dot
      transitions.push({ kind: "join", from, to: lane, hash: slot });
    });

    // A hole at the far right would only pad the graph, so trim it before measuring.
    while (pending.length > 0 && pending[pending.length - 1] === null) pending.pop();

    laneCount = Math.max(laneCount, above.length, after.length);
    drawn.add(hash);
    lanes.push(lane);
    rows.push({ above, after, tip, transitions, gaps });
  });

  return { lanes, rows, laneCount, ordered };
}
