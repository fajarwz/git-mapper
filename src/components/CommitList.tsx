import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Commit, CommitRef, Repository } from "../types";
import { layoutGraph } from "../lib/graphLanes";
import { graphWidth } from "../lib/graphGeometry";
import {
  COMMIT_HEADER_GRID,
  DEFAULT_AUTHOR_WIDTH,
  DEFAULT_DATE_WIDTH,
  HASH_WIDTH,
  MAX_AUTHOR_WIDTH,
  MAX_DATE_WIDTH,
  MAX_GRAPH_EXTRA,
  MAX_MESSAGE_WIDTH,
  MIN_AUTHOR_WIDTH,
  MIN_DATE_WIDTH,
  MIN_GRAPH_WIDTH,
  MIN_MESSAGE_WIDTH,
  DEFAULT_GRAPH_LANES,
} from "../lib/tableLayout";
import { PANEL } from "../lib/ui";
import { CommitGraph } from "./CommitGraph";
import { CommitRow } from "./CommitRow";
import { ResizeHandle } from "./ResizeHandle";

interface CommitListProps {
  repo: Repository;
  /**
   * The commits to render: repo.commits when no search query is active, the filtered subset
   * otherwise. The graph layout and the rows both work off this list, and the "no matches"
   * notice keys off the query.
   */
  commits: Commit[];
  query: string;
  selectedHash: string;
  /** Commits a refresh just added or re-pilled; they flash once. */
  flashHashes: Set<string>;
  onSelect: (hash: string) => void;
  loadingMore: boolean;
  /** True while a slept tab reloads after being clicked: history is on its way back. */
  waking?: boolean;
  onNearBottom: () => void;
  onCheckoutBranch: (branch: string) => void;
  /** Right-click on a row (or one of its pills): opens the commit context menu. */
  onContextMenu?: (commit: Commit, ref: CommitRef | undefined, x: number, y: number) => void;
}

function widthOf(element: HTMLElement | null, fallback: number): number {
  return element ? element.getBoundingClientRect().width : fallback;
}

const HEADER_CELL = "relative flex h-full min-w-0 items-center";

export function CommitList({ repo, commits, query, selectedHash, flashHashes, onSelect, loadingMore, waking = false, onNearBottom, onCheckoutBranch, onContextMenu }: CommitListProps) {
  // One layout for the graph column and the SVG. Sizing the column from the dot lanes alone used to
  // clip the graph whenever a line ran right of every dot.
  const layout = useMemo(
    () => layoutGraph(commits.map((commit) => ({ hash: commit.hash, parents: commit.parents }))),
    [commits],
  );
  const baseGraphWidth = graphWidth(layout.laneCount);

  // null keeps the message column flexible; dragging pins it to a pixel width.
  // The graph gutter is the same idea: null = fit mode, the column hugs the lanes the layout
  // needs; a drag pins an ABSOLUTE width. Pinning an offset instead (old behaviour) went
  // negative when a search or refresh re-laid the lanes narrower — width zeroed out, the
  // graph vanished and the header slammed left.
  const [pinnedGraphWidth, setPinnedGraphWidth] = useState<number | null>(null);
  const [messageWidth, setMessageWidth] = useState<number | null>(null);
  const [authorWidth, setAuthorWidth] = useState(DEFAULT_AUTHOR_WIDTH);
  const [dateWidth, setDateWidth] = useState(DEFAULT_DATE_WIDTH);

  const graphColumnRef = useRef<HTMLDivElement>(null);
  const messageCellRef = useRef<HTMLSpanElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);

  // Keep the viewport anchored across data reloads (branch switch, page append):
  // re-apply the last scroll offset whenever the commit list is replaced.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && lastScrollTop.current > 0) el.scrollTop = lastScrollTop.current;
  }, [commits]);

  // A pinned width outlives lane re-counts unchanged (no header jump on search), but is
  // clamped to the current layout's legal range: never under one lane, never past the
  // natural width plus the extra the splitter allows. Fit mode is capped at
  // DEFAULT_GRAPH_LANES: a lane-heavy history gets a compact default, and the splitter
  // widens it (the clipped lanes come back) instead of the column starting enormous.
  const graphColumnWidth =
    pinnedGraphWidth === null
      ? Math.min(baseGraphWidth, graphWidth(DEFAULT_GRAPH_LANES))
      : Math.max(MIN_GRAPH_WIDTH, Math.min(pinnedGraphWidth, baseGraphWidth + MAX_GRAPH_EXTRA));

  const columns = {
    "--graph-width": `${graphColumnWidth}px`,
    // The whole track expression lives in the variable: a fixed px track when pinned, flexible otherwise.
    "--col-message": messageWidth === null ? "minmax(0,1fr)" : `${messageWidth}px`,
    "--col-author": `${authorWidth}px`,
    "--col-date": `${dateWidth}px`,
    "--col-hash": `${HASH_WIDTH}px`,
    // A pinned message column leaves the leftover space to a spacer; unpinned, the message fills it.
    "--col-spacer": messageWidth === null ? "0px" : "1fr",
  } as CSSProperties;

  const measureMessage = () => widthOf(messageCellRef.current, 300);

  // While the message column is flexible (1fr, the first-load state) it absorbs every track
  // change on its right — an author/date drag then looked inverted: the dragged edge stayed
  // pinned against the hash column while the column grew from its far side. Pinning the
  // message to its live width hands the leftover to the spacer, and the dragged edge follows
  // the pointer like any desktop table.
  function pinMessageWidth(): number {
    const measured = measureMessage();
    setMessageWidth(clampMessageWidth(measured, graphColumnWidth, authorWidth, dateWidth));
    return measured;
  }

  // Keep the pinned message column inside the window: the header and rows use the same 52px of gaps/padding.
  function clampMessageWidth(width: number, graph: number, author: number, date: number): number {
    const sectionWidth = sectionRef.current?.getBoundingClientRect().width ?? 0;
    const limit = sectionWidth
      ? sectionWidth - (graph + author + date + HASH_WIDTH + 52)
      : MAX_MESSAGE_WIDTH;
    const max = Math.max(MIN_MESSAGE_WIDTH, Math.min(MAX_MESSAGE_WIDTH, limit));
    return Math.max(MIN_MESSAGE_WIDTH, Math.min(max, width));
  }

  function handleAuthorResize(width: number) {
    if (messageWidth === null) pinMessageWidth();
    setAuthorWidth(width);
    setMessageWidth((current) =>
      current === null ? current : clampMessageWidth(current, graphColumnWidth, width, dateWidth),
    );
  }

  function handleDateResize(width: number) {
    if (messageWidth === null) pinMessageWidth();
    setDateWidth(width);
    setMessageWidth((current) =>
      current === null ? current : clampMessageWidth(current, graphColumnWidth, authorWidth, width),
    );
  }

  function handleGraphResize(width: number) {
    if (messageWidth === null) pinMessageWidth();
    setPinnedGraphWidth(Math.max(MIN_GRAPH_WIDTH, width));
    setMessageWidth((current) =>
      current === null
        ? current
        : clampMessageWidth(current, width, authorWidth, dateWidth),
    );
  }

  return (
    <section
      ref={sectionRef}
      className={`${PANEL} relative flex min-h-0 flex-col overflow-hidden`}
      style={columns}
      aria-label={`History of ${repo.name}`}
    >
      <div
        data-commit-header
        className={`grid h-8 shrink-0 items-center gap-2 border-b border-rule bg-sheet pr-3 text-[11.5px] font-semibold text-ink-dim ${COMMIT_HEADER_GRID}`}
      >
        <span aria-hidden="true" />

        <span ref={messageCellRef} className={HEADER_CELL}>
          Commit
          <ResizeHandle
            variant="column"
            label="Resize commit column"
            min={MIN_MESSAGE_WIDTH}
            max={MAX_MESSAGE_WIDTH}
            value={messageWidth ?? undefined}
            measure={measureMessage}
            onResize={(width) =>
              setMessageWidth(clampMessageWidth(width, graphColumnWidth, authorWidth, dateWidth))
            }
            onReset={() => setMessageWidth(null)}
          />
        </span>

        <span className={HEADER_CELL}>
          Author
          <ResizeHandle
            variant="column"
            label="Resize author column"
            min={MIN_AUTHOR_WIDTH}
            max={MAX_AUTHOR_WIDTH}
            value={authorWidth}
            measure={() => authorWidth}
            onResize={handleAuthorResize}
            onReset={() => setAuthorWidth(DEFAULT_AUTHOR_WIDTH)}
          />
        </span>

        <span className={HEADER_CELL}>
          Date
          <ResizeHandle
            variant="column"
            label="Resize date column"
            min={MIN_DATE_WIDTH}
            max={MAX_DATE_WIDTH}
            value={dateWidth}
            measure={() => dateWidth}
            onResize={handleDateResize}
            onReset={() => setDateWidth(DEFAULT_DATE_WIDTH)}
          />
        </span>

        <span className="flex h-full items-center">Hash</span>
        <span aria-hidden="true" />
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        onScroll={(event) => {
          const el = event.currentTarget;
          lastScrollTop.current = el.scrollTop;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 320) onNearBottom();
        }}
      >
        <div ref={graphColumnRef} className="w-(--graph-width) shrink-0 self-start overflow-hidden">
          <CommitGraph commits={commits} layout={layout} selectedHash={selectedHash} />
        </div>
        <div className="min-w-0 flex-1 pl-2 pr-3">
          {commits.map((commit) => (
            <CommitRow
              key={commit.hash}
              commit={commit}
              selected={commit.hash === selectedHash}
              fresh={flashHashes.has(commit.hash)}
              onSelect={onSelect}
              onCheckoutBranch={onCheckoutBranch}
              onContextMenu={onContextMenu ? (row, x, y) => {
                // The row's most relevant ref: its branch, falling back to the first pill.
                const ref = row.refs.find((item) => item.type === "branch") ?? row.refs[0];
                onContextMenu(row, ref, x, y);
              } : undefined}
              onRefContextMenu={onContextMenu ? (row, ref, x, y) => onContextMenu(row, ref, x, y) : undefined}
            />
          ))}
          {commits.length === 0 && query !== "" && (
            <p className="m-0 py-2 text-center text-[12px] text-ink-dim">
              No commits in the loaded history match this search.
            </p>
          )}
          {waking && commits.length === 0 && query === "" && (
            <p className="m-0 py-2 text-center text-[12px] text-ink-dim">Loading history…</p>
          )}
          {loadingMore && (
            <p className="m-0 py-2 text-center text-[12px] text-ink-dim">Loading more history…</p>
          )}
        </div>
      </div>

      <ResizeHandle
        variant="splitter"
        label="Resize graph column"
        className="left-(--graph-width)"
        // The floor is absolute, not the graph's natural width: a wide multi-lane layout must
        // still be draggable down. Overflowing lanes clip on the right (the column hides them).
        min={MIN_GRAPH_WIDTH}
        max={baseGraphWidth + MAX_GRAPH_EXTRA}
        value={graphColumnWidth}
        measure={() => widthOf(graphColumnRef.current, graphColumnWidth)}
        onResize={handleGraphResize}
        onReset={() => setPinnedGraphWidth(null)}
      />
    </section>
  );
}
