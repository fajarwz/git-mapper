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

  // Stash rows float (no lane held down to their base), so this connector is drawn by hand:
  // dashed, in the stash row's own branch hue, so dot, link and pill match like any branch.
  const stashEdges = useMemo(() => {
    const indexByHash = new Map(commits.map((commit, index) => [commit.hash, index]));
    return commits.flatMap((commit, index) => {
      if (commit.stashIndex === undefined) return [];
      const baseIndex = indexByHash.get(commit.parents[0] ?? "");
      if (baseIndex === undefined) return [];
      const x1 = laneX(layout.lanes[index] ?? 0);
      const y1 = rowY(index);
      const x2 = laneX(layout.lanes[baseIndex] ?? 0);
      const y2 = rowY(baseIndex);
      const d = Math.min(Math.abs(y2 - y1) * 0.8, ROW_HEIGHT);
      return [{
        key: `stash-${commit.hash}`,
        path: `M ${x1} ${y1} C ${x1} ${y1 + d}, ${x2} ${y2 - d}, ${x2} ${y2}`,
        color: branchColor(layout.branchColors[index] ?? 0),
      }];
    });
  }, [commits, layout]);

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
          strokeDasharray={edge.uncommitted ? "5 4" : undefined}
          strokeLinecap="round"
        />
      ))}

      {stashEdges.map((edge) => (
        <path
          key={edge.key}
          d={edge.path}
          fill="none"
          stroke={edge.color}
          strokeWidth={2}
          strokeDasharray="5 4"
          strokeLinecap="round"
        />
      ))}

      {commits.map((commit, index) => {
        const lane = layout.lanes[index] ?? 0;
        const x = laneX(lane);
        const y = rowY(index);
        const selected = commit.hash === selectedHash;
        const checkedOut = commit.refs.some((ref) => ref.isCurrent);
        // The dot takes its branch colour, stash rows included (the dash marks them instead);
        // only the uncommitted row renders in the reserved gray.
        const color =
          commit.hash === "wip"
            ? UNCOMMITTED_COLOR
            : branchColor(layout.branchColors[index] ?? 0);

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
