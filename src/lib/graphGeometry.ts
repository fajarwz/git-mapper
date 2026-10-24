import { MAX_LANES } from "./graphLanes";
import type { LaneLayout } from "./graphLanes";

/** Fixed row height in px. The commit rows and the SVG graph both use it so they stay aligned. */
export const ROW_HEIGHT = 32;
export const LANE_WIDTH = 16;
export const GRAPH_PADDING_X = 14;
export const DOT_RADIUS = 3.5;

/** One hue per lane, so adjacent columns always read apart. Tokens, so themes carry over. */
export const LANE_COLORS = [
  "var(--color-lane-1)",
  "var(--color-lane-2)",
  "var(--color-lane-3)",
  "var(--color-lane-4)",
  "var(--color-lane-5)",
  "var(--color-lane-6)",
  "var(--color-lane-7)",
  "var(--color-lane-8)",
];

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

export function laneX(lane: number): number {
  return GRAPH_PADDING_X + Math.min(lane, MAX_LANES - 1) * LANE_WIDTH;
}

export function rowY(index: number): number {
  return index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

export function graphWidth(laneCount: number): number {
  return GRAPH_PADDING_X * 2 + Math.max(Math.min(laneCount, MAX_LANES) - 1, 0) * LANE_WIDTH;
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
 * Bends stay inside one row band: a lane that forks, joins or shifts leans across the row of the
 * commit that causes it, so divergence and convergence sit exactly where the history has them
 * instead of on a long diagonal. Straight pieces are collected per lane and colour and merged while
 * they stay contiguous, so a line that runs for thirty rows is one path. Every piece that cannot be
 * merged starts its own path — merging by key alone would silently drop the earlier piece.
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

  layout.rows.forEach(({ above, after, tip }, row) => {
    const lane = layout.lanes[row];
    const midY = rowY(row);
    const inY = midY - ROW_HEIGHT / 2;
    const outY = midY + ROW_HEIGHT / 2;

    const available = above.map((hash, index) => ({ hash, index, used: false }));

    after.forEach((hash, to) => {
      // A line takes the hue of the column it sits in on the next row.
      const color = laneColor(to);
      const source = available.find((entry) => !entry.used && entry.hash === hash);
      if (source) {
        source.used = true;
        if (source.index === to) {
          addVertical(to, inY, outY, color);
        } else {
          edges.push({
            key: `r${row}:${source.index}->${to}`,
            path: bend(laneX(source.index), inY, laneX(to), outY),
            color,
          });
        }
        return;
      }
      // Not running before this row: it forked off the commit's dot.
      edges.push({
        key: `r${row}:dot->${to}`,
        path: bend(laneX(lane), midY, laneX(to), outY),
        color,
      });
    });

    // Whatever is left above ends in the dot: another child's reservation joining in, or the
    // commit itself arriving on its own lane. A tip has neither — nothing may be drawn above it.
    for (const entry of available) {
      if (entry.used) continue;
      if (tip && entry.index === lane) continue;
      edges.push({
        key: `r${row}:${entry.index}->dot`,
        path: bend(laneX(entry.index), inY, laneX(lane), midY),
        color: laneColor(lane),
      });
    }

    // Gaps between rows.
    if (row < layout.rows.length - 1) {
      const gapTo = rowY(row + 1) - ROW_HEIGHT / 2;
      after.forEach((_hash, index) => addVertical(index, outY, gapTo, laneColor(index)));
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
