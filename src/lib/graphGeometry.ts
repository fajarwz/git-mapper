import { LINE_COLOR_COUNT } from "./graphLanes";
import type { LaneLayout, LaneSlot } from "./graphLanes";

/** Fixed row height in px. The commit rows and the SVG graph both use it so they stay aligned. */
export const ROW_HEIGHT = 32;
export const LANE_WIDTH = 16;
export const GRAPH_PADDING_X = 14;
export const DOT_RADIUS = 3.5;

/** One hue per line. Tokens, so themes carry over; indexed by the layout's colour slot. */
export const LINE_COLORS = [
  "var(--color-lane-1)",
  "var(--color-lane-2)",
  "var(--color-lane-3)",
  "var(--color-lane-4)",
  "var(--color-lane-5)",
  "var(--color-lane-6)",
  "var(--color-lane-7)",
  "var(--color-lane-8)",
];

/** Palette entry for a line. Takes a colour slot, never a lane index: lanes move, lines do not. */
export function lineColor(color: number): string {
  return LINE_COLORS[color % LINE_COLOR_COUNT];
}

/**
 * X of a lane. No clamping: lanes 8, 9, 10 used to share the x of lane 7, which drew distinct
 * lines on top of each other and made their colours look wrong. The graph grows instead.
 */
export function laneX(lane: number): number {
  return GRAPH_PADDING_X + lane * LANE_WIDTH;
}

export function rowY(index: number): number {
  return index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

/** Width that fits every lane the layout uses, dot radius and stroke included. */
export function graphWidth(laneCount: number): number {
  const lanes = Math.max(laneCount, 1);
  return GRAPH_PADDING_X * 2 + (lanes - 1) * LANE_WIDTH;
}

export interface GraphEdge {
  key: string;
  path: string;
  color: string;
}

interface Vertical {
  lane: number;
  from: number;
  to: number;
  color: string;
}

function bend(fromX: number, fromY: number, toX: number, toY: number): string {
  if (Math.abs(fromX - toX) < 0.01) return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  const half = (toY - fromY) * 0.5;
  return `M ${fromX} ${fromY} C ${fromX} ${fromY + half}, ${toX} ${toY - half} ${toX} ${toY}`;
}

/**
 * Turns the layout into SVG paths.
 *
 * Every piece takes the colour of the **line** it belongs to, never of the column it passes
 * through: a line that shifts lanes is drawn in one hue on both sides of the shift, a line joining
 * another keeps its own hue down to the dot, and a line forked off a merge commit starts with the
 * colour the layout gave it. Colour is decided once, in layoutGraph.
 *
 * Bends stay inside one row band: a lane that forks, joins or shifts leans across the row of the
 * commit that causes it, so divergence and convergence sit exactly where the history has them
 * instead of on a long diagonal. Straight pieces are collected per lane and colour and merged while
 * they stay contiguous, so a line that runs for thirty rows is one path. Every piece that cannot be
 * merged starts its own path.
 */
export function buildEdges(layout: LaneLayout): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const runs: Vertical[] = [];
  const open = new Map<string, Vertical>();
  const addVertical = (lane: number, from: number, to: number, color: string) => {
    if (to - from < 0.01) return;
    const key = `${lane}:${color}`;
    const previous = open.get(key);
    if (previous && Math.abs(previous.to - from) < 0.01) {
      previous.to = to;
      return;
    }
    const run = { lane, from, to, color };
    runs.push(run);
    open.set(key, run);
  };

  layout.rows.forEach(({ above, after, tip, join }, row) => {
    const lane = layout.lanes[row];
    const midY = rowY(row);
    const inY = midY - ROW_HEIGHT / 2;
    const outY = midY + ROW_HEIGHT / 2;

    const available = above.map((slot: LaneSlot, index: number) => ({ slot, index, used: false }));

    after.forEach((slot, to) => {
      const color = lineColor(slot.color);
      const source = available.find((entry) => !entry.used && entry.slot.hash === slot.hash);
      if (source) {
        source.used = true;
        if (source.index === to) {
          addVertical(to, inY, outY, color);
        } else {
          // Same line, new column: the hue travels with it.
          edges.push({
            key: `r${row}:${source.index}->${to}`,
            path: bend(laneX(source.index), inY, laneX(to), outY),
            color,
          });
        }
        return;
      }
      // Not running before this row: a line forked off the commit's dot, in its own new colour.
      edges.push({
        key: `r${row}:dot->${to}`,
        path: bend(laneX(lane), midY, laneX(to), outY),
        color,
      });
    });

    // Whatever is left above ends in the dot: another child's reservation joining in, or the
    // commit itself arriving on its own lane. A tip has neither, nothing may be drawn above it.
    for (const entry of available) {
      if (entry.used) continue;
      if (tip && entry.index === lane) continue;
      edges.push({
        key: `r${row}:${entry.index}->dot`,
        path: bend(laneX(entry.index), inY, laneX(lane), midY),
        // The joining line keeps its own colour down to the dot.
        color: lineColor(entry.slot.color),
      });
    }

    // This commit's line ends in a parent that already had one: draw the short piece that bends
    // into that parent's lane. Without it a tip that joins an existing line leaves its dot dangling
    // next to the line it belongs to.
    if (join !== null && after[join]) {
      edges.push({
        key: `r${row}:dot->join${join}`,
        path: bend(laneX(lane), midY, laneX(join), outY),
        color: lineColor(after[join].color),
      });
    }

    // Gaps between rows.
    if (row < layout.rows.length - 1) {
      const gapTo = rowY(row + 1) - ROW_HEIGHT / 2;
      after.forEach((slot, index) => addVertical(index, outY, gapTo, lineColor(slot.color)));
    }
  });

  runs.forEach((run, index) => {
    edges.push({
      key: `run${index}`,
      path: `M ${laneX(run.lane)} ${run.from} L ${laneX(run.lane)} ${run.to}`,
      color: run.color,
    });
  });

  return edges;
}
