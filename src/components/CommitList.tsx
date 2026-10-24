import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Repository } from "../types";
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
  selectedHash: string;
  onSelect: (hash: string) => void;
}

function widthOf(element: HTMLElement | null, fallback: number): number {
  return element ? element.getBoundingClientRect().width : fallback;
}

const HEADER_CELL = "relative flex h-full min-w-0 items-center";

export function CommitList({ repo, selectedHash, onSelect }: CommitListProps) {
  const laneCount = Math.max(...repo.commits.map((commit) => commit.lane), 0) + 1;
  const baseGraphWidth = graphWidth(laneCount);

  // null keeps the message column flexible; dragging pins it to a pixel width.
  const [graphExtra, setGraphExtra] = useState(0);
  const [messageWidth, setMessageWidth] = useState<number | null>(null);
  const [authorWidth, setAuthorWidth] = useState(DEFAULT_AUTHOR_WIDTH);
  const [dateWidth, setDateWidth] = useState(DEFAULT_DATE_WIDTH);

  const graphColumnRef = useRef<HTMLDivElement>(null);
  const messageCellRef = useRef<HTMLSpanElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

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
        className={`grid h-11 shrink-0 items-center gap-2 border-b border-rule bg-sheet pr-3 text-[11.5px] font-semibold text-ink-dim ${COMMIT_HEADER_GRID}`}
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

      <div className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div ref={graphColumnRef} className="w-[var(--graph-width)] shrink-0">
          <CommitGraph commits={repo.commits} selectedHash={selectedHash} />
        </div>
        <div className="min-w-0 flex-1 pl-2 pr-3">
          {repo.commits.map((commit) => (
            <CommitRow
              key={commit.hash}
              commit={commit}
              selected={commit.hash === selectedHash}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>

      <ResizeHandle
        variant="splitter"
        label="Resize graph column"
        className="left-[var(--graph-width)]"
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
