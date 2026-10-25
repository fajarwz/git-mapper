import { LINE_COLOR_COUNT } from "./graphLanes";
import type { GraphLayout, BranchPath, BranchLine } from "./graphLanes";

/** Fixed row height in px. The commit rows and the SVG graph both use it so they stay aligned. */
export const ROW_HEIGHT = 32;
export const LANE_WIDTH = 16;
export const GRAPH_PADDING_X = 14;
export const DOT_RADIUS = 3.5;

/** One hue per branch. Tokens, so themes carry over. */
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

/** Uncommitted changes are drawn in neutral gray, matching vscode-git-graph. */
export const UNCOMMITTED_COLOR = "#808080";

/**
 * Colour of a branch. Lines and dots belonging to the same branch share this colour even when the
 * branch changes horizontal lane, which is the look of vscode-git-graph.
 */
export function branchColor(branchColorIndex: number): string {
  return LINE_COLORS[branchColorIndex % LINE_COLOR_COUNT];
}

/** Kept for callers that still think in lanes; the colour is now branch-based. */
export function laneColor(lane: number): string {
  return branchColor(lane);
}

/**
 * X of a lane. No clamping: two active lanes must never share a coordinate, so a graph that needs
 * more lanes than the palette gets wider instead of drawing lines on top of each other.
 */
export function laneX(lane: number): number {
  return GRAPH_PADDING_X + lane * LANE_WIDTH;
}

export function rowY(index: number): number {
  return index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

/** Width that fits every lane the layout uses. */
export function graphWidth(laneCount: number): number {
  const lanes = Math.max(laneCount, 1);
  return GRAPH_PADDING_X * 2 + (lanes - 1) * LANE_WIDTH;
}

export interface GraphEdge {
  key: string;
  path: string;
  color: string;
}

/**
 * Turns branch paths into SVG paths. Consecutive vertical segments in the same branch are merged
 * so long runs draw as one path element.
 */
export function buildEdges(layout: GraphLayout): GraphEdge[] {
  const edges: GraphEdge[] = [];

  layout.branches.forEach((branch: BranchPath, branchIndex: number) => {
    // Simplify consecutive straight vertical lines, preserving the committed/uncommitted split.
    const lines: BranchLine[] = [];
    for (const line of branch.lines) {
      const last = lines[lines.length - 1];
      if (
        last &&
        last.x1 === last.x2 &&
        last.x2 === line.x1 &&
        line.x1 === line.x2 &&
        last.y2 === line.y1 &&
        last.committed === line.committed
      ) {
        last.y2 = line.y2;
      } else {
        lines.push({ ...line });
      }
    }

    let path = "";
    let previousCommitted = true;
    let segmentStart = 0;

    const flush = (end: number) => {
      if (path === "") return;
      const color = previousCommitted ? branchColor(branch.color) : UNCOMMITTED_COLOR;
      edges.push({
        key: `b${branchIndex}-${segmentStart}`,
        path,
        color,
      });
      path = "";
      segmentStart = end;
    };

    lines.forEach((line, i) => {
      if (i > 0 && line.committed !== previousCommitted) {
        flush(i);
      }
      previousCommitted = line.committed;

      const x1 = laneX(line.x1);
      const y1 = rowY(line.y1);
      const x2 = laneX(line.x2);
      const y2 = rowY(line.y2);

      if (path === "" || i === 0 || x1 !== laneX(lines[i - 1].x2) || y1 !== rowY(lines[i - 1].y2)) {
        path += `M ${x1} ${y1}`;
      }

      if (Math.abs(x1 - x2) < 0.01) {
        path += ` L ${x2} ${y2}`;
      } else {
        // vscode-git-graph rounded style: keep the line vertical for most of the row, then bend
        // near each end. d = 0.8 of the vertical distance produces the smooth S-curve.
        const d = Math.abs(y2 - y1) * 0.8;
        path += ` C ${x1} ${y1 + d}, ${x2} ${y2 - d}, ${x2} ${y2}`;
      }
    });

    flush(lines.length);
  });

  return edges;
}
