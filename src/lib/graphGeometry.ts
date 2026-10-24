import { LINE_COLOR_COUNT } from "./graphLanes";
import type { LaneLayout, LaneTransition } from "./graphLanes";

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
 * Turns the layout's recorded transitions into SVG paths.
 *
 * Nothing is derived here: the sweep already decided which lane each piece starts and ends in, what
 * kind of piece it is and which colour it carries, so this function only converts coordinates.
 * Pieces that stay in one lane are collected per lane and colour and merged while they stay
 * contiguous, so a line running for thirty rows is one path.
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

  layout.rows.forEach((row, index) => {
    const midY = rowY(index);
    const inY = midY - ROW_HEIGHT / 2;
    const outY = midY + ROW_HEIGHT / 2;
    const gapTo = index < layout.rows.length - 1 ? rowY(index + 1) - ROW_HEIGHT / 2 : outY;

    row.transitions.forEach((transition: LaneTransition, order: number) => {
      const color = lineColor(transition.color);
      const key = `r${index}:${transition.kind}:${order}`;
      switch (transition.kind) {
        case "continue":
          addVertical(transition.to, inY, outY, color);
          break;
        case "shift":
          edges.push({
            key,
            path: bend(laneX(transition.from), inY, laneX(transition.to), outY),
            color,
          });
          break;
        case "fork":
          // Leaves the dot: first parent, merge parent, or a tip joining a line below.
          edges.push({
            key,
            path: bend(laneX(transition.from), midY, laneX(transition.to), outY),
            color,
          });
          break;
        case "join":
        default:
          // Another child's line arrives at this dot, in its own colour.
          edges.push({
            key,
            path: bend(laneX(transition.from), inY, laneX(transition.to), midY),
            color,
          });
          break;
      }
    });

    // Gaps between rows: the lines still running leave this row band and enter the next one.
    if (index < layout.rows.length - 1) {
      row.after.forEach((slot, lane) => addVertical(lane, outY, gapTo, lineColor(slot.color)));
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
