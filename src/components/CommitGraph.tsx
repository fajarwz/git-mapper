import { useMemo } from "react";
import type { Commit } from "../types";
import type { GraphLayout } from "../lib/graphLanes";
import {
  DOT_RADIUS,
  ROW_HEIGHT,
  UNCOMMITTED_COLOR,
  branchColor,
  buildEdges,
  graphWidth,
  laneX,
  rowY,
} from "../lib/graphGeometry";

interface CommitGraphProps {
  commits: Commit[];
  /** Computed once by CommitList: the graph column is sized from it, so it cannot differ. */
  layout: GraphLayout;
  selectedHash: string;
}

/**
 * SVG graph for the whole history. Branches keep their colour across lane changes and curves are
 * drawn as smooth S-curves, matching vscode-git-graph. Same ROW_HEIGHT as the commit rows, so a dot
 * always lines up with its row.
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
        // The dot takes its branch colour; uncommitted changes render in gray.
        const color = commit.hash === "wip" ? UNCOMMITTED_COLOR : branchColor(layout.branchColors[index] ?? 0);

        return (
          <g key={commit.hash}>
            {/* GitKraken's connector: the lane colour runs from the node to the message column,
                where the row's own chip picks it up and carries it to the title. */}
            <rect
              x={x + DOT_RADIUS + 3}
              y={y - 2}
              width={Math.max(0, width - x - DOT_RADIUS - 3)}
              height={4}
              fill={color}
            />
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
              // HEAD sits here: hollow ring, same branch colour as its line.
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
