import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Repository } from "../../types";
import type { PullRequestsView } from "../pull-requests/hooks/usePullRequests";
import { PullRequestMenu } from "../pull-requests/components/PullRequestMenu";
import { GLASS_CONTROL } from "../../shared/lib/ui";
import { Shortcut, withShortcut } from "./shortcuts";
import {
  BranchIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BrandGlyph,
  CloseIcon,
  PlusIcon,
  RefreshIcon,
  RemoteIcon,
  RemotesIcon,
  RepoIcon,
  SearchIcon,
  SettingsIcon,
  ChangesIcon,
  WindowCloseIcon,
  WindowMaximizeIcon,
  WindowMinimizeIcon,
  WindowRestoreIcon,
} from "../../shared/components/icons";

/**
 * The window is undecorated (tauri.conf.json: decorations false), so this bar IS the
 * title bar: it carries the brand, the repo tabs, the toolbar actions and the caption
 * buttons. It sits flush on the aurora canvas instead of a separate white strip.
 */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type WindowAction = "minimize" | "toggleMaximize" | "close";

async function windowAction(action: WindowAction): Promise<void> {
  // Browser tabs have no window to drive; the dev server still renders the bar.
  if (!IN_TAURI) return;
  const current = getCurrentWindow();
  await current[action]();
}

function BrandMark() {
  return (
    <span className="grid place-items-center rounded-lg bg-primary text-white soft-shadow size-6">
      <BrandGlyph />
    </span>
  );
}

function TabLabel({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setClipped(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span ref={ref} className={`min-w-0 flex-1 truncate text-[12.5px] ${clipped ? "tab-fade" : ""}`}>
      {text}
    </span>
  );
}

interface TitleBarProps {
  repos: Repository[];
  activeId: string | null;
  repo: Repository | null;
  adding: boolean;
  refreshing: boolean;
  findOpen: boolean;
  onToggleFind: () => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
  /** Move the tab at `from` into position `to`, after a drop. */
  onReorder: (from: number, to: number) => void;
  onRefresh: () => void;
  onFetch: () => void;
  onOpenRemotes: () => void;
  fetching: boolean;
  onOpenSettings: () => void;
  updateReady?: boolean;
  onRestartToUpdate?: () => void;
  onPull: () => void;
  onPush: () => void;
  syncing: boolean;
  /** The failed op and git's message, shown on the button that failed until the timeout. */
  syncError: { op: "pull" | "push"; message: string } | null;
  stageCount: number;
  stageOpen: boolean;
  onToggleStage: () => void;
  pulls: PullRequestsView;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

interface SortableTabProps {
  item: Repository;
  active: boolean;
  suppressed: { current: boolean };
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

/**
 * One tab. @dnd-kit/sortable owns the drag: it measures the row and animates every tab by
 * transform as you move, so the others slide out of the way smoothly instead of jumping slots,
 * and it keeps the keyboard route (space to lift, arrows to move) working.
 */
function SortableTab({ item, active, suppressed, onSelect, onClose }: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const { role: _handleRole, ...handleAria } = attributes;

  return (
    <div
      ref={setNodeRef}
      data-tab-id={item.id}
      data-active={active}
      data-dragging={isDragging}
      data-sleeping={item.sleeping ? "true" : undefined}
      style={{
        flex: "1 1 200px",
        minWidth: 68,
        maxWidth: 200,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`inline-flex h-7 min-w-0 items-center gap-1 rounded-lg border border-transparent bg-glass-soft pl-2.5 text-left text-ink-soft backdrop-blur-md transition-[background-color,border-color,color,box-shadow,opacity] hover:bg-glass hover:text-ink hover:soft-shadow data-[active=true]:border-hairline data-[active=true]:bg-glass-strong data-[active=true]:text-ink data-[active=true]:soft-shadow data-[dragging=true]:opacity-30 data-[sleeping=true]:opacity-55 data-[sleeping=true]:hover:opacity-100`}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        title={item.sleeping ? `${item.path} (slept to save memory — click to reload)` : item.path}
        {...listeners}
        {...handleAria}
        onClick={() => {
          if (suppressed.current) {
            suppressed.current = false;
            return;
          }
          onSelect(item.id);
        }}
        className="flex h-full min-w-0 flex-1 cursor-grab touch-none items-center gap-1.5 bg-transparent p-0 pr-1 text-left text-inherit active:cursor-grabbing"
      >
        <span className="shrink-0 text-ink-dim">
          <RepoIcon size={12} />
        </span>
        <TabLabel text={item.name} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose(item.id);
        }}
        aria-label={`Close ${item.name}`}
        title={active ? withShortcut(`Close ${item.name}`, Shortcut.CloseTab) : `Close ${item.name}`}
        className="mr-1 grid shrink-0 place-items-center rounded-full text-ink-dim hover:bg-hover-glass hover:text-ink size-4.5"
      >
        <CloseIcon size={8} />
      </button>
    </div>
  );
}

export function TitleBar({
  repos,
  activeId,
  repo,
  adding,
  refreshing,
  findOpen,
  onToggleFind,
  onSelect,
  onAdd,
  onClose,
  onReorder,
  onRefresh,
  onFetch,
  onOpenRemotes,
  fetching,
  onOpenSettings,
  updateReady = false,
  onRestartToUpdate,
  onPull,
  onPush,
  syncing,
  syncError,
  stageCount,
  stageOpen,
  onToggleStage,
  pulls,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  // The click that ends a drag must not also select the tab that was dropped.
  const suppressClick = useRef(false);

  // Pointer only on purpose: the keyboard sensor claims Space and Enter on the focused tab, and a
  // tab has to stay activatable from the keyboard. Keyboard reordering would need a grip handle.
  const sensors = useSensors(
    // Distance, not delay: a click stays a click, a drag lifts after four pixels.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    suppressClick.current = true;
    setDraggedId(String(event.active.id));
  }

  /** The click that ends a drag lands in the same task as the drop, so clear the flag after it. */
  function armClickSuppressionReset() {
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedId(null);
    armClickSuppressionReset();
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = repos.findIndex((item) => item.id === active.id);
    const to = repos.findIndex((item) => item.id === over.id);
    if (from !== -1 && to !== -1) onReorder(from, to);
  }

  const dragged = repos.find((item) => item.id === draggedId) ?? null;

  useEffect(() => {
    if (!IN_TAURI) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const current = getCurrentWindow();
      const sync = async () => {
        const value = await current.isMaximized();
        if (!cancelled) setMaximized(value);
      };
      await sync();
      stop = await current.onResized(() => {
        void sync();
      });
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  function handleDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    void windowAction("toggleMaximize");
  }

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
      className="flex h-10 shrink-0 items-center gap-2 pl-2.5"
    >
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-2 rounded-xl border border-hairline/60 bg-glass-soft py-0.5 pl-1 pr-2.5 backdrop-blur-md"
      >
        <BrandMark />
        <span data-tauri-drag-region className="text-[12.5px] font-bold tracking-tight text-ink">
          Git Mapper
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label="Go back"
          title="Go back (Alt+Left)"
          className={`${GLASS_CONTROL} grid place-items-center text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-40 size-7`}
        >
          <ArrowLeftIcon size={12} />
        </button>
        <button
          type="button"
          onClick={onForward}
          disabled={!canGoForward}
          aria-label="Go forward"
          title="Go forward (Alt+Right)"
          className={`${GLASS_CONTROL} grid place-items-center text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-40 size-7`}
        >
          <ArrowRightIcon size={12} />
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setDraggedId(null);
          armClickSuppressionReset();
        }}
      >
        <SortableContext items={repos.map((item) => item.id)} strategy={horizontalListSortingStrategy}>
          <div
            data-tauri-drag-region
            role="tablist"
            aria-label="Open repositories"
            className="no-scrollbar ml-1 flex min-w-0 flex-1 select-none items-center gap-1 overflow-x-auto overflow-y-hidden"
          >
            {repos.map((item) => (
              <SortableTab
                key={item.id}
                item={item}
                active={item.id === activeId}
                suppressed={suppressClick}
                onSelect={onSelect}
                onClose={onClose}
              />
            ))}

            <button
              type="button"
              onClick={onAdd}
              disabled={adding}
              aria-label="Open repository"
              title={withShortcut("Open a repository folder", Shortcut.NewTab)}
              className="grid shrink-0 place-items-center rounded-lg border border-dashed border-rule bg-glass-soft text-ink-soft backdrop-blur-md hover:bg-glass-strong hover:text-ink disabled:opacity-60 size-7"
            >
              <PlusIcon />
            </button>
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" }}>
          {dragged ? (
            <div
              data-tab-overlay
              className="flex h-7 min-w-0 scale-103 items-center gap-1.5 rounded-lg border border-hairline bg-glass-strong pl-2.5 pr-1 text-[13px] font-semibold text-ink soft-shadow"
            >
              <span className="shrink-0 text-ink-dim">
                <RepoIcon size={12} />
              </span>
              <span className="min-w-0 flex-1 truncate">{dragged.name}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className="flex shrink-0 items-center gap-1.5">
        {repo && (
          // Search lives in a floating bar (Ctrl+F), so the bar only carries its summon.
          <button
            type="button"
            onClick={onToggleFind}
            aria-pressed={findOpen}
            aria-label="Find in history"
            title="Find in history (Ctrl+F)"
            className={`${GLASS_CONTROL} grid place-items-center text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 size-7 ${
              findOpen ? "border-primary-ink/40 bg-glass-strong text-ink soft-shadow" : ""
            }`}
          >
            <SearchIcon size={13} />
          </button>
        )}
        {repo && (
          // The edge takes primary-ink, not primary: primary-ink is re-pointed in .dark
          // (violet -> lavender), so the hairline stays visible on the dark glass too.
          <span className="inline-flex max-w-47.5 items-center gap-1.25 rounded-full border border-primary-ink/35 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary-ink">
            <BranchIcon size={11} />
            <span className="truncate">{repo.branch}</span>
          </span>
        )}
        {repo && (
          <button
            type="button"
            onClick={onToggleStage}
            disabled={stageCount === 0 && !stageOpen}
            aria-pressed={stageOpen}
            aria-label={stageOpen ? "Hide uncommitted changes" : "Show uncommitted changes"}
            title={
              stageCount === 0
                ? "No uncommitted changes"
                : stageOpen
                  ? `Hide uncommitted changes (${stageCount})`
                  : `Show uncommitted changes (${stageCount})`
            }
            className={`${GLASS_CONTROL} relative grid place-items-center text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 size-7 disabled:opacity-50 ${
              stageOpen ? "border-primary-ink/40 bg-glass-strong text-ink soft-shadow" : ""
            }`}
          >
            <ChangesIcon size={13} />
            {stageCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border-[1.5px] border-warning bg-surface font-mono text-[9px] font-bold leading-none text-warning-ink soft-shadow"
              >
                {stageCount > 9 ? "9+" : stageCount}
              </span>
            )}
          </button>
        )}
        {repo && <PullRequestMenu pulls={pulls} />}
        {repo && (
          <button
            type="button"
            onClick={onFetch}
            disabled={fetching}
            aria-label="Fetch from remotes"
            title={fetching ? "Fetching from the remotes…" : "Fetch all remotes (updates the behind/ahead counters)"}
            className={`${GLASS_CONTROL} grid place-items-center text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-50 size-7`}
          >
            <RemoteIcon size={13} className={fetching ? "animate-spin" : undefined} />
          </button>
        )}
        {repo && (
          <button
            type="button"
            onClick={onOpenRemotes}
            aria-label="Manage remotes"
            title="Manage remotes (add, rename, remove)"
            className={`${GLASS_CONTROL} grid place-items-center text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 size-7`}
          >
            <RemotesIcon size={13} />
          </button>
        )}
        {repo && repo.branch !== "HEAD detached" && (
          <>
            <button
              type="button"
              onClick={onPull}
              disabled={syncing}
              aria-label={`Pull ${repo.branch}`}
              title={`Pull ${repo.branch} (fast-forward only)${syncError?.op === "pull" ? ` — ${syncError.message}` : ""}`}
              className={`${GLASS_CONTROL} inline-flex h-7 min-w-7 place-items-center justify-center gap-0.5 px-1.5 text-[11px] font-semibold leading-none ${
                syncError?.op === "pull"
                  ? "text-danger"
                  : repo.behind > 0
                    ? "text-warning-ink hover:bg-sheet-strong"
                    : "text-ink-dim hover:bg-sheet-strong hover:text-ink"
              } focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-50`}
            >
              <ArrowDownIcon size={11} />
              {repo.behind > 0 ? repo.behind : ""}
            </button>
            <button
              type="button"
              onClick={onPush}
              disabled={syncing}
              aria-label={`Push ${repo.branch}`}
              title={`Push ${repo.branch} to ${repo.upstream || "origin"}${syncError?.op === "push" ? ` — ${syncError.message}` : ""}`}
              className={`${GLASS_CONTROL} inline-flex h-7 min-w-7 place-items-center justify-center gap-0.5 px-1.5 text-[11px] font-semibold leading-none ${
                syncError?.op === "push"
                  ? "text-danger"
                  : repo.ahead > 0
                    ? "text-success-ink hover:bg-sheet-strong"
                    : "text-ink-dim hover:bg-sheet-strong hover:text-ink"
              } focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-50`}
            >
              <ArrowUpIcon size={11} />
              {repo.ahead > 0 ? repo.ahead : ""}
            </button>
          </>
        )}

        {updateReady && onRestartToUpdate && (
          <button
            type="button"
            onClick={onRestartToUpdate}
            title="A new version is downloaded. Restart to install it."
            className="h-7 shrink-0 whitespace-nowrap rounded-full bg-primary px-3 text-[11px] font-semibold text-white soft-shadow hover:brightness-110 focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2"
          >
            Restart to update
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing || !repo}
          aria-label="Refresh"
          title="Reload the current repository"
          className={`${GLASS_CONTROL} grid place-items-center text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-50 size-7`}
        >
          <RefreshIcon width={13} height={13} className={refreshing ? "animate-spin" : undefined} />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open settings"
          title="Settings"
          className={`${GLASS_CONTROL} relative grid place-items-center text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 size-7`}
        >
          <SettingsIcon size={13} />
        </button>
      </div>

      <div className="ml-1 flex h-10 shrink-0 items-stretch self-stretch">
        <button
          type="button"
          onClick={() => void windowAction("minimize")}
          aria-label="Minimize"
          title="Minimize"
          className="grid w-11 place-items-center text-ink-soft hover:bg-hover-glass"
        >
          <WindowMinimizeIcon />
        </button>
        <button
          type="button"
          onClick={() => void windowAction("toggleMaximize")}
          aria-label={maximized ? "Restore" : "Maximize"}
          title={maximized ? "Restore" : "Maximize"}
          className="grid w-11 place-items-center text-ink-soft hover:bg-hover-glass"
        >
          {maximized ? <WindowRestoreIcon /> : <WindowMaximizeIcon />}
        </button>
        <button
          type="button"
          onClick={() => void windowAction("close")}
          aria-label="Close"
          title="Close"
          className="grid w-11 place-items-center text-ink-soft hover:bg-danger hover:text-white"
        >
          <WindowCloseIcon />
        </button>
      </div>
    </div>
  );
}
