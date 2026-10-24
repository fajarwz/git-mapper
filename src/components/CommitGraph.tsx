import { useMemo } from "react";
import type { Commit } from "../types";
import type { LaneLayout } from "../lib/graphLanes";
import {
  DOT_RADIUS,
  ROW_HEIGHT,
  buildEdges,
  graphWidth,
  laneX,
  lineColor,
  rowY,
} from "../lib/graphGeometry";

interface CommitGraphProps {
  commits: Commit[];
  /** Computed once by CommitList: the graph column is sized from it, so it cannot differ. */
  layout: LaneLayout;
  selectedHash: string;
}

/**
 * SVG graph for the whole history. Lanes come from layoutGraph and every line is drawn inside one
 * row band, so forks and joins sit exactly on the commit that causes them. Same ROW_HEIGHT as the
 * commit rows, so a dot always lines up with its row.
 */
export function CommitGraph({ commits, layout, selectedHash }: CommitGraphProps) {
  const edges = useMemo(() => buildEdges(layout), [layout]);

  const width = graphWidth(layout.laneCount);
  const height = commits.length * ROW_HEIGHT;

  return (
    <svg data-commit-graph className="block" width={width} height={height} aria-hidden="true">
      {edges.map((edge) => (
        <path
          key={edge.key}
          d={edge.path}
          fill="none"
          stroke={edge.color}
          strokeWidth={2}
          strokeLinecap="round"
        />
      ))}

      {commits.map((commit, index) => {
        const lane = layout.lanes[index] ?? 0;
        const x = laneX(lane);
        const y = rowY(index);
        const selected = commit.hash === selectedHash;
        const checkedOut = commit.refs.some((ref) => ref.isCurrent);
        // The dot belongs to a line, so it takes the line's colour, not its column's.
        const color = lineColor(layout.colors[index] ?? 0);

        return (
          <g key={commit.hash}>
            {selected && (
              <circle
                cx={x}
                cy={y}
                r={DOT_RADIUS + 3}
                fill="none"
                stroke="var(--color-ink)"
                strokeWidth={1.4}
              />
            )}
            {checkedOut ? (
              // HEAD sits here: hollow ring, same lane colour as its line.
              <circle
                cx={x}
                cy={y}
                r={DOT_RADIUS + 1.5}
                fill="var(--color-surface)"
                stroke={color}
                strokeWidth={2.4}
              />
            ) : (
              <circle
                cx={x}
                cy={y}
                r={DOT_RADIUS}
                fill={color}
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            )}
            <title>{`${commit.hash} ${commit.subject}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
