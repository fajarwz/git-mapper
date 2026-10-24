import { MAX_LANES } from "./graphLanes";
import type { LaneLayout } from "./graphLanes";

/** Fixed row height in px. The commit rows and the SVG graph both use it so they stay aligned. */
export const ROW_HEIGHT = 32;
export const LANE_WIDTH = 16;
export const GRAPH_PADDING_X = 14;
export const DOT_RADIUS = 3.5;
/** Hard lane cap, shared with the layout: past it lanes are drawn on top of each other. */
export { MAX_LANES };

/** Lane colours as tokens, so the graph follows the active theme. */
export const LANE_COLORS = [
  "var(--color-lane-1)",
  "var(--color-lane-2)",
  "var(--color-lane-3)",
  "var(--color-lane-4)",
  "var(--color-lane-5)",
  "var(--color-lane-6)",
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
 * instead of on a long diagonal. Everything vertical is merged into one path per lane and colour,
 * so the element count follows the number of lanes, not the number of rows.
 */
export function buildEdges(layout: LaneLayout): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const colorOf = (hash: string) => laneColor(layout.colors.get(hash) ?? 0);
  const runs = new Map<string, Vertical>();

  const addVertical = (lane: number, from: number, to: number, color: string) => {
    if (to - from < 0.01) return;
    const key = `${lane}:${color}`;
    const run = runs.get(key);
    // Contiguous pieces of the same lane and colour become one line.
    if (run && Math.abs(run.to - from) < 0.01) {
      run.to = to;
      return;
    }
    runs.set(key, { lane, from, to, color });
  };

  layout.rows.forEach(({ above, after }, row) => {
    const lane = layout.lanes[row];
    const midY = rowY(row);
    const inY = midY - ROW_HEIGHT / 2;
    const outY = midY + ROW_HEIGHT / 2;

    const available = above.map((hash, index) => ({ hash, index, used: false }));

    after.forEach((hash, to) => {
      const color = colorOf(hash);
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
    // commit itself arriving on its lane.
    for (const entry of available) {
      if (entry.used) continue;
      edges.push({
        key: `r${row}:${entry.index}->dot`,
        path: bend(laneX(entry.index), inY, laneX(lane), midY),
        color: colorOf(entry.hash),
      });
    }

    // Gaps between rows.
    if (row < layout.rows.length - 1) {
      const gapFrom = outY;
      const gapTo = rowY(row + 1) - ROW_HEIGHT / 2;
      after.forEach((hash, index) => addVertical(index, gapFrom, gapTo, colorOf(hash)));
    }
  });

  for (const [key, run] of runs) {
    edges.push({
      key: `run:${key}`,
      path: `M ${laneX(run.lane)} ${run.from} L ${laneX(run.lane)} ${run.to}`,
      color: run.color,
    });
  }

  return edges;
}
