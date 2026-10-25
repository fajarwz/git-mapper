import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Commit, Repository } from "../types";
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
  MIN_MESSAGE_WIDTH,
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
  onNearBottom: () => void;
  onCheckoutBranch: (branch: string) => void;
}

function widthOf(element: HTMLElement | null, fallback: number): number {
  return element ? element.getBoundingClientRect().width : fallback;
}

const HEADER_CELL = "relative flex h-full min-w-0 items-center";

export function CommitList({ repo, commits, query, selectedHash, flashHashes, onSelect, loadingMore, onNearBottom, onCheckoutBranch }: CommitListProps) {
  // One layout for the graph column and the SVG. Sizing the column from the dot lanes alone used to
  // clip the graph whenever a line ran right of every dot.
  const layout = useMemo(
    () => layoutGraph(commits.map((commit) => ({ hash: commit.hash, parents: commit.parents }))),
    [commits],
  );
  const baseGraphWidth = graphWidth(layout.laneCount);

  // null keeps the message column flexible; dragging pins it to a pixel width.
  const [graphExtra, setGraphExtra] = useState(0);
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

  const graphColumnWidth = baseGraphWidth + graphExtra;

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
    setAuthorWidth(width);
    setMessageWidth((current) =>
      current === null ? current : clampMessageWidth(current, graphColumnWidth, width, dateWidth),
    );
  }

  function handleDateResize(width: number) {
    setDateWidth(width);
    setMessageWidth((current) =>
      current === null ? current : clampMessageWidth(current, graphColumnWidth, authorWidth, width),
    );
  }

  function handleGraphResize(width: number) {
    setGraphExtra(width - baseGraphWidth);
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
        <div ref={graphColumnRef} className="w-(--graph-width) shrink-0">
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
            />
          ))}
          {commits.length === 0 && query !== "" && (
            <p className="m-0 py-2 text-center text-[12px] text-ink-dim">
              No commits in the loaded history match this search.
            </p>
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
        min={baseGraphWidth}
        max={baseGraphWidth + MAX_GRAPH_EXTRA}
        value={graphColumnWidth}
        measure={() => widthOf(graphColumnRef.current, graphColumnWidth)}
        onResize={handleGraphResize}
        onReset={() => setGraphExtra(0)}
      />
    </section>
  );
}
