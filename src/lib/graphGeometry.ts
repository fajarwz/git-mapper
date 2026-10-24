import type { Commit } from "../types";

/** Fixed row height in px. The commit rows and the SVG graph both use it so they stay aligned. */
export const ROW_HEIGHT = 32;
export const LANE_WIDTH = 16;
export const GRAPH_PADDING_X = 14;
export const DOT_RADIUS = 3.5;
/** Hard lane cap; beyond it graphLanes recycles lanes so the graph can never exceed this width. */
export const MAX_LANES = 6;

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

/**
 * Builds one path per commit -> parent link. Lane positions come from the mock data, so this is
 * only geometry, not a layout algorithm.
 *
 * When the parent sits in a different lane, the link moves sideways inside the child's row and
 * then runs straight down the parent's lane. Read from the parent upwards, a branch line stays
 * vertical until it reaches the commit it joins, instead of drifting sideways across the whole gap.
 */
export function buildEdges(commits: Commit[]): GraphEdge[] {
  const indexByHash = new Map<string, number>();
  commits.forEach((commit, index) => indexByHash.set(commit.hash, index));

  const edges: GraphEdge[] = [];
  commits.forEach((commit, index) => {
    const fromX = laneX(commit.lane);
    const fromY = rowY(index);

    commit.parents.forEach((parentHash) => {
      const parentIndex = indexByHash.get(parentHash);
      if (parentIndex === undefined) return;

      const parent = commits[parentIndex];
      const toX = laneX(parent.lane);
      const toY = rowY(parentIndex);

      // An edge takes the colour of the lane it ends in, so the vertical run keeps one colour.
      const color = laneColor(parent.lane);

      let path: string;
      if (fromX === toX) {
        path = `M ${fromX} ${fromY} L ${toX} ${toY}`;
      } else {
        const bend = Math.min(ROW_HEIGHT, toY - fromY);
        path =
          `M ${fromX} ${fromY} ` +
          `C ${fromX} ${fromY + bend * 0.55}, ${toX} ${fromY + bend * 0.45} ${toX} ${fromY + bend} ` +
          `L ${toX} ${toY}`;
      }

      edges.push({ key: `${commit.hash}->${parentHash}`, path, color });
    });
  });

  return edges;
}
