import { useMemo } from "react";
import type { Commit } from "../types";
import { layoutGraph } from "../lib/graphLanes";
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
 * SVG graph for the whole history. Lanes come from layoutGraph and every line is drawn inside one
 * row band, so forks and joins sit exactly on the commit that causes them. Same ROW_HEIGHT as the
 * commit rows, so a dot always lines up with its row.
 */
export function CommitGraph({ commits, selectedHash }: CommitGraphProps) {
  const layout = useMemo(
    () => layoutGraph(commits.map((commit) => ({ hash: commit.hash, parents: commit.parents }))),
    [commits],
  );
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
        const color = laneColor(layout.colors.get(commit.hash) ?? lane);

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
