import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { DndContext, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors } from "@dnd-kit/core";
import type { CollisionDetection, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import type { Commit, CommitRef, Repository } from "../types";
import { UNCOMMITTED_HASH, isStashRow } from "../data/gitLoader";
import { layoutGraph } from "../lib/graphLanes";
import { graphWidth } from "../lib/graphGeometry";
import {
  COMMIT_HEADER_GRID,
  DEFAULT_COLUMNS,
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
  COLUMN_LABELS,
  DEFAULT_ORDER,
  commitGrids,
  normalizeOrder,
  shownColumns,
  type ColumnId,
  type ColumnKey,
} from "../lib/tableLayout";
import { STORAGE_KEYS, usePersistedState } from "../lib/persisted";
import { PANEL } from "../lib/ui";
import { CommitGraph } from "./CommitGraph";
import { ColumnsMenu } from "./ColumnsMenu";
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
  /** The initials avatar left of the username; a settings toggle owns this. */
  showAvatars: boolean;
  onNearBottom: () => void;
  onCheckoutBranch: (branch: string) => void;
  /** Right-click on a row (or one of its pills): opens the commit context menu. */
  onContextMenu?: (commit: Commit, ref: CommitRef | undefined, x: number, y: number) => void;
}

function widthOf(element: HTMLElement | null, fallback: number): number {
  return element ? element.getBoundingClientRect().width : fallback;
}

const HEADER_CELL = "relative flex h-full min-w-0 items-center";
/** The cell under the pointer wins, not the nearest centre: the commit column is far wider than
 * the rest, so its centre sits nowhere near where a drop on it lands. */
const columnCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};

const COLUMN_TITLES: Record<ColumnId, string> = { message: "Commit", ...COLUMN_LABELS };

/** One header cell. Only the label is the drag grip, so the resize handle inside the cell keeps
 * its own pointer drag; @dnd-kit slides the other cells out of the way as this one moves. */
function HeaderCell({
  id,
  label,
  innerRef,
  children,
}: {
  id: ColumnId;
  label: string;
  innerRef?: Ref<HTMLSpanElement>;
  children?: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const { role: _role, ...aria } = attributes;
  return (
    <span
      ref={(node) => {
        setNodeRef(node);
        if (typeof innerRef === "function") innerRef(node);
        else if (innerRef) (innerRef as { current: HTMLSpanElement | null }).current = node;
      }}
      data-column-id={id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`${HEADER_CELL} ${isDragging ? "z-10 opacity-60" : ""}`}
    >
      <span
        {...listeners}
        {...aria}
        title="Drag to reorder"
        className="min-w-0 flex-1 cursor-grab touch-none select-none truncate active:cursor-grabbing"
      >
        {label}
      </span>
      {children}
    </span>
  );
}

export function CommitList({ repo, commits, query, selectedHash, flashHashes, onSelect, loadingMore, waking = false, showAvatars, onNearBottom, onCheckoutBranch, onContextMenu }: CommitListProps) {
  // One layout for the graph column and the SVG. Sizing the column from the dot lanes alone used to
  // clip the graph whenever a line ran right of every dot.
  // Same inputs as gitLoader.withLanes (stash rows float, the uncommitted row is flagged) —
  // a different shape here desyncs the SVG from the rows' lanes and colours.
  const layout = useMemo(
    () =>
      layoutGraph(
        commits.map((commit) => ({
          hash: commit.hash,
          parents: isStashRow(commit) ? [] : commit.parents,
          uncommitted: commit.hash === UNCOMMITTED_HASH,
        })),
      ),
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

  const [stored, setStored] = usePersistedState(STORAGE_KEYS.commitColumns, DEFAULT_COLUMNS);
  const visible = useMemo(() => ({ ...DEFAULT_COLUMNS, ...stored }), [stored]);
  const [columnsMenu, setColumnsMenu] = useState<{ x: number; y: number } | null>(null);
  const closeColumnsMenu = useCallback(() => setColumnsMenu(null), []);
  const toggleColumn = (column: ColumnKey) => setStored({ ...visible, [column]: !visible[column] });
  const [storedOrder, setStoredOrder] = usePersistedState<ColumnId[]>(STORAGE_KEYS.commitColumnOrder, DEFAULT_ORDER);
  const order = useMemo(() => normalizeOrder(storedOrder), [storedOrder]);
  const shown = useMemo(() => shownColumns(visible, order), [visible, order]);
  const grids = commitGrids(visible, order);
  // Distance, not delay: a click on a header stays a click, a drag lifts after four pixels.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  function handleColumnDrop({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = shown.indexOf(active.id as ColumnId);
    const to = shown.indexOf(over.id as ColumnId);
    if (from < 0 || to < 0) return;
    // Hidden columns keep their slot in the stored order: only the shown ones move.
    const moved = arrayMove(shown, from, to);
    const hidden = order.filter((id) => !shown.includes(id));
    setStoredOrder([...moved, ...hidden]);
  }

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
    "--header-grid": grids.header,
    "--row-grid": grids.row,
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
    const shown = (visible.author ? author : 0) + (visible.date ? date : 0) + (visible.hash ? HASH_WIDTH : 0);
    const gaps = 8 * (2 + Object.values(visible).filter(Boolean).length) + 12;
    const limit = sectionWidth ? sectionWidth - (graph + shown + gaps) : MAX_MESSAGE_WIDTH;
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

  const resizers: Partial<Record<ColumnId, ReactNode>> = {
    message: (
      <ResizeHandle
        variant="column"
        label="Resize commit column"
        min={MIN_MESSAGE_WIDTH}
        max={MAX_MESSAGE_WIDTH}
        value={messageWidth ?? undefined}
        measure={measureMessage}
        onResize={(width) => setMessageWidth(clampMessageWidth(width, graphColumnWidth, authorWidth, dateWidth))}
        onReset={() => setMessageWidth(null)}
      />
    ),
    author: (
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
    ),
    date: (
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
    ),
  };

  return (
    <section
      ref={sectionRef}
      className={`${PANEL} relative flex min-h-0 flex-col overflow-hidden`}
      style={columns}
      aria-label={`History of ${repo.name}`}
    >
      <div
        data-commit-header
        onContextMenu={(event) => {
          event.preventDefault();
          setColumnsMenu({ x: event.clientX, y: event.clientY });
        }}
        className={`grid h-8 shrink-0 items-center gap-2 border-b border-rule bg-sheet pr-3 text-[11.5px] font-semibold text-ink-dim ${COMMIT_HEADER_GRID}`}
      >
        <span aria-hidden="true" />

        <DndContext sensors={sensors} collisionDetection={columnCollision} onDragEnd={handleColumnDrop}>
          <SortableContext items={shown} strategy={horizontalListSortingStrategy}>
            {shown.map((id) => (
              <HeaderCell key={id} id={id} label={COLUMN_TITLES[id]} innerRef={id === "message" ? messageCellRef : undefined}>
                {resizers[id]}
              </HeaderCell>
            ))}
          </SortableContext>
        </DndContext>

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
              showAvatar={showAvatars}
              columns={visible}
              order={order}
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
      {columnsMenu && (
        <ColumnsMenu {...columnsMenu} visible={visible} onToggle={toggleColumn} onClose={closeColumnsMenu} />
      )}
    </section>
  );
}
