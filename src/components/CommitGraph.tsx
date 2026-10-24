import type { Commit } from "../types";
import {
  DOT_RADIUS,
  ROW_HEIGHT,
  buildEdges,
  graphWidth,
  laneColor,
  laneX,
  rowY,
} from "../lib/graphGeometry";

interface CommitGraphProps {
  commits: Commit[];
  selectedHash: string;
}

/**
 * SVG graph for the whole history. Rendered in the same scroll container as the rows and using
 * the same ROW_HEIGHT, so a commit's dot always lines up with its row.
 */
export function CommitGraph({ commits, selectedHash }: CommitGraphProps) {
  const laneCount = Math.max(...commits.map((commit) => commit.lane), 0) + 1;
  const width = graphWidth(laneCount);
  const height = commits.length * ROW_HEIGHT;
  const edges = buildEdges(commits);

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
        const x = laneX(commit.lane);
        const y = rowY(index);
        const selected = commit.hash === selectedHash;
        const checkedOut = commit.refs.some((ref) => ref.isCurrent);

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
              // HEAD sits here: hollow ring, same lane colour as the edges.
              <circle
                cx={x}
                cy={y}
                r={DOT_RADIUS + 1.5}
                fill="var(--color-surface)"
                stroke={laneColor(commit.lane)}
                strokeWidth={2.4}
              />
            ) : (
              <circle
                cx={x}
                cy={y}
                r={DOT_RADIUS}
                fill={laneColor(commit.lane)}
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
