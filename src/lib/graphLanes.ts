/**
 * Lane layout: an active-lane sweep over a newest-first commit list, recording every graph piece
 * as it goes.
 *
 * The model is a set of active lanes, one entry per line that is still running. Each entry carries
 * the commit the line is heading for and the line's colour, so colour belongs to the line and not
 * to the column it happens to occupy. Lanes are the position of a line, slots are its identity.
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
 * Colour rule: a new line takes the palette entry used by the fewest active lines, skipping the
 * colours of the lanes on either side of it, ties to the lowest index. Deterministic for identical
 * input, stable for lines that already exist, never repaints a line on screen.
 */
export const LINE_COLOR_COUNT = 8;

export interface LaneSlot {
  /** Commit this line is heading for. */
  hash: string;
  /** Palette index of the line. */
  color: number;
}

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
  /** Lane the piece ends in. For `join` that is the dot lane. */
  to: number;
  /** Palette index this piece is drawn with. */
  color: number;
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
  /** Lane per commit: where its dot sits. */
  lanes: number[];
  /** Palette index per commit: the colour of the line its dot belongs to. */
  colors: number[];
  rows: LaneRow[];
  /** Lanes needed at the widest row, for the SVG width. */
  laneCount: number;
  /** False when a parent appeared above its child (input was not newest-first topological). */
  ordered: boolean;
}

/** Least-used palette entry around `at`, neighbour colours skipped, ties to the lowest index. */
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

  // Every entry sits next to the new line (only possible with the whole palette active).
  best = 0;
  for (let color = 1; color < LINE_COLOR_COUNT; color += 1) {
    if (uses[color] < uses[best]) best = color;
  }
  return best;
}

export function layoutGraph(commits: Array<{ hash: string; parents: string[] }>): LaneLayout {
  const input = new Set(commits.map((commit) => commit.hash));
  const pending: LaneSlot[] = [];
  const lanes: number[] = [];
  const colors: number[] = [];
  const rows: LaneRow[] = [];
  const drawn = new Set<string>();
  let laneCount = 1;
  let ordered = true;

  commits.forEach(({ hash, parents }) => {
    // Defensive only: the same hash twice could not own two dots.
    if (drawn.has(hash)) ordered = false;

    let lane = pending.findIndex((slot) => slot.hash === hash);
    const tip = lane === -1;
    if (tip) {
      const parentLine = parents[0] ? pending.find((slot) => slot.hash === parents[0]) : undefined;
      lane = pending.length;
      pending.push({ hash, color: parentLine ? parentLine.color : pickColor(pending, lane) });
    }

    // Snapshot before any mutation: this row's incoming geometry must not change under it.
    const above = pending.map((slot) => ({ ...slot }));
    const color = pending[lane].color;
    const gaps: LaneGap[] = parents
      .filter((parent) => !input.has(parent))
      .map((parent) => ({ hash: parent, reason: "unloaded" as const }));
    // Parents whose line already exists, so the dot connects to it instead of opening a new one.
    const stubs: string[] = [];
    const first = parents[0];

    if (first === undefined) {
      pending.splice(lane, 1); // root: the lane ends here
    } else if (drawn.has(first)) {
      // The parent is already above this row, so the input is not topological. Never draw a line
      // that points upward: drop the connection and mark the layout unordered.
      ordered = false;
      gaps.push({ hash: first, reason: "out-of-order" });
      pending.splice(lane, 1);
    } else if (pending.some((slot, index) => index !== lane && slot.hash === first)) {
      // Another child already holds a line for that parent: this line ends and bends into it.
      pending.splice(lane, 1);
      stubs.push(first);
    } else {
      pending[lane] = { hash: first, color };
    }

    for (const parent of parents.slice(1)) {
      if (drawn.has(parent)) {
        ordered = false;
        gaps.push({ hash: parent, reason: "out-of-order" });
        continue;
      }
      if (pending.some((slot) => slot.hash === parent)) {
        stubs.push(parent); // that line already exists: connect to it instead of opening another
        continue;
      }
      const at = Math.min(lane + 1, pending.length);
      pending.splice(at, 0, { hash: parent, color: pickColor(pending, at) });
    }

    const after = pending.map((slot) => ({ ...slot }));

    // Record the pieces. A hash occupies one lane at most, so a line appearing below is either the
    // same line moving (`continue` / `shift`) or a line that starts at this dot (`fork`).
    const transitions: LaneTransition[] = [];
    after.forEach((slot, to) => {
      const from = above.findIndex((entry) => entry.hash === slot.hash);
      if (from === -1) {
        transitions.push({ kind: "fork", from: lane, to, color: slot.color, hash: slot.hash });
      } else {
        transitions.push({
          kind: from === to ? "continue" : "shift",
          from,
          to,
          color: slot.color,
          hash: slot.hash,
        });
      }
    });
    // A parent whose line already runs beside this row: the dot bends into that line.
    for (const hash of stubs) {
      const at = after.findIndex((slot) => slot.hash === hash);
      if (at !== -1) {
        transitions.push({ kind: "fork", from: lane, to: at, color: after[at].color, hash });
      }
    }
    above.forEach((slot, from) => {
      if (after.some((entry) => entry.hash === slot.hash)) return;
      if (tip && from === lane) return; // a tip has nothing above its dot
      transitions.push({ kind: "join", from, to: lane, color: slot.color, hash: slot.hash });
    });

    laneCount = Math.max(laneCount, above.length, after.length);
    drawn.add(hash);
    lanes.push(lane);
    colors.push(color);
    rows.push({ above, after, tip, transitions, gaps });
  });

  return { lanes, colors, rows, laneCount, ordered };
}
