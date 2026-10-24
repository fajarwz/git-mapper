import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Repository } from "../types";
import { GLASS_CONTROL } from "../lib/ui";
import {
  BranchIcon,
  CloseIcon,
  PlusIcon,
  RepoIcon,
  SettingsIcon,
  WindowCloseIcon,
  WindowMaximizeIcon,
  WindowMinimizeIcon,
  WindowRestoreIcon,
} from "./icons";

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
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  await current[action]();
}

function BrandMark() {
  return (
    <span className="grid h-6 w-6 place-items-center rounded-lg bg-primary text-white shadow-soft">
      {/* Drawn in currentColor on the solid brand fill: white on violet reads on either canvas. */}
      <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M4.5 4.5v9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <path
          d="M13.5 4.5v3c0 3.2-4.2 2.6-7.6 3.6"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <circle cx="4.5" cy="4.5" r="2.1" fill="currentColor" />
        <circle cx="13.5" cy="4.5" r="2.1" fill="currentColor" />
        <circle cx="4.5" cy="13.5" r="1.7" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </span>
  );
}

/** Tab label that fades its right edge once it stops fitting, like a Chrome tab. */
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

/** The chip look shared by a resting tab and the lifted copy that follows the pointer. */
const TAB_CHIP =
  "flex h-7 min-w-0 items-center gap-1.5 rounded-lg border border-hairline bg-glass-strong pl-2.5 pr-1 text-[13px] font-semibold text-ink soft-shadow";

interface TitleBarProps {
  repos: Repository[];
  activeId: string | null;
  repo: Repository | null;
  adding: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
  /** Move the tab at `from` into position `to`, used while dragging. */
  onReorder: (from: number, to: number) => void;
  onOpenSettings: () => void;
}

interface DragState {
  id: string;
  name: string;
  /** Ghost box, in viewport coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** True once the pointer is released and the ghost slides into its slot. */
  dropping: boolean;
}

export function TitleBar({
  repos,
  activeId,
  repo,
  adding,
  onSelect,
  onAdd,
  onClose,
  onReorder,
  onOpenSettings,
}: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);

  // Tabs reorder by pointer, not HTML5 drag-and-drop: the webview hands drag events to Tauri's
  // own file-drop handler, so `draggable` never fires reliably inside the app.
  const stripRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const tabRects = useRef(new Map<string, DOMRect>());

  function beginTabDrag(event: React.PointerEvent<HTMLDivElement>, index: number, item: Repository) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button[aria-label^='Close']")) return;

    const start = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - start.left;
    const offsetY = event.clientY - start.top;
    suppressClick.current = false;

    let moving = false;
    let currentIndex = index;
    let frame = 0;

    const stopAutoScroll = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    // Keep the strip scrolling while the pointer sits near either edge, so long strips stay usable.
    const autoScroll = (clientX: number) => {
      const strip = stripRef.current;
      if (!strip) return;
      const box = strip.getBoundingClientRect();
      const edge = 28;
      const direction = clientX < box.left + edge ? -1 : clientX > box.right - edge ? 1 : 0;
      if (direction === 0) {
        stopAutoScroll();
        return;
      }
      if (frame) return;
      const step = () => {
        const target = stripRef.current;
        if (!target) {
          frame = 0;
          return;
        }
        target.scrollLeft += direction * 6;
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (!moving) {
        // A few pixels of slack so a plain click stays a click.
        if (Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) < 4) {
          return;
        }
        moving = true;
        document.body.style.cursor = "grabbing";
      }

      setDrag({
        id: item.id,
        name: item.name,
        x: moveEvent.clientX - offsetX,
        y: moveEvent.clientY - offsetY,
        width: start.width,
        height: start.height,
        dropping: false,
      });
      autoScroll(moveEvent.clientX);

      const strip = stripRef.current;
      if (!strip) return;
      const tabs = [...strip.querySelectorAll<HTMLElement>("[data-tab-id]")];
      const over = tabs.findIndex((node) => {
        const rect = node.getBoundingClientRect();
        return moveEvent.clientX >= rect.left && moveEvent.clientX <= rect.right;
      });
      if (over === -1 || over === currentIndex) return;
      onReorder(currentIndex, over);
      currentIndex = over;
    };

    const finish = () => {
      stopAutoScroll();
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);

      if (!moving) {
        setDrag(null);
        return;
      }

      // Slide the ghost into the slot the tab now occupies, then hand the tab back to the strip.
      suppressClick.current = true;
      const slot = stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${item.id}"]`);
      if (!slot) {
        setDrag(null);
        return;
      }
      const target = slot.getBoundingClientRect();
      setDrag((current) =>
        current
          ? { ...current, dropping: true, x: target.left, y: target.top, width: target.width }
          : current,
      );
      window.setTimeout(() => setDrag(null), 200);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  // Tabs that shift because of a reorder slide into place instead of teleporting.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const nodes = [...strip.querySelectorAll<HTMLElement>("[data-tab-id]")];

    for (const node of nodes) {
      const id = node.dataset.tabId;
      if (!id) continue;
      const rect = node.getBoundingClientRect();
      const before = tabRects.current.get(id);
      tabRects.current.set(id, rect);
      if (!before || reduceMotion || !node.animate) continue;
      const delta = before.left - rect.left;
      if (Math.abs(delta) < 0.5) continue;
      node.animate(
        [{ transform: `translateX(${delta}px)` }, { transform: "translateX(0)" }],
        { duration: 170, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
      );
    }
  }, [repos]);

  // The caption button swaps to a restore glyph while the window is maximized.
  useEffect(() => {
    if (!IN_TAURI) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
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
    // Double-clicking the empty bar maximizes, the way a native title bar does.
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

      <div
        data-tauri-drag-region
        role="tablist"
        aria-label="Open repositories"
        ref={stripRef}
        className="no-scrollbar ml-1 flex min-w-0 flex-1 select-none items-center gap-1 overflow-x-auto overflow-y-hidden"
      >
        {repos.map((item, index) => {
          const active = item.id === activeId;
          const lifted = drag?.id === item.id;
          return (
            <div
              key={item.id}
              data-active={active}
              data-tab-id={item.id}
              onPointerDown={(event) => beginTabDrag(event, index, item)}
              style={{ flex: "1 1 200px", minWidth: 68, maxWidth: 200 }}
              className={`inline-flex h-7 min-w-0 items-center gap-1 rounded-lg border border-transparent bg-glass-soft pl-2.5 text-left text-ink-soft backdrop-blur-md transition-colors hover:bg-hover-glass data-[active=true]:border-hairline data-[active=true]:bg-glass-strong data-[active=true]:text-ink data-[active=true]:soft-shadow ${
                lifted ? "opacity-0" : ""
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={item.path}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  onSelect(item.id);
                }}
                className="flex h-full min-w-0 flex-1 cursor-grab items-center gap-1.5 bg-transparent p-0 pr-1 text-left text-inherit active:cursor-grabbing"
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
                title={`Close ${item.name}`}
                className="mr-1 grid h-4.5 w-4.5 shrink-0 cursor-default place-items-center rounded-full text-ink-dim hover:bg-hover-glass hover:text-ink"
              >
                <CloseIcon size={8} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={onAdd}
          disabled={adding}
          aria-label="Open repository"
          title="Open a repository folder"
          className="grid h-7 w-7 shrink-0 cursor-default place-items-center rounded-lg border border-dashed border-rule bg-glass-soft text-ink-soft backdrop-blur-md hover:bg-glass-strong hover:text-ink disabled:opacity-60"
        >
          <PlusIcon />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {repo && (
          <span className="inline-flex max-w-[190px] items-center gap-[5px] rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary-ink">
            <BranchIcon size={11} />
            <span className="truncate">{repo.branch}</span>
          </span>
        )}
        {repo && repo.ahead > 0 && (
          <span className="font-mono text-[11px] font-semibold text-success-ink">↑{repo.ahead}</span>
        )}
        {repo && repo.behind > 0 && (
          <span className="font-mono text-[11px] font-semibold text-warning-ink">↓{repo.behind}</span>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open settings"
          title="Settings"
          className={`${GLASS_CONTROL} grid h-7 w-7 cursor-default place-items-center text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70`}
        >
          <SettingsIcon size={13} />
        </button>
      </div>

      {/* Caption buttons, flush with the window edge. */}
      <div className="ml-1 flex h-10 shrink-0 items-stretch self-stretch">
        <button
          type="button"
          onClick={() => void windowAction("minimize")}
          aria-label="Minimize"
          title="Minimize"
          className="grid w-11 cursor-default place-items-center text-ink-soft hover:bg-hover-glass"
        >
          <WindowMinimizeIcon />
        </button>
        <button
          type="button"
          onClick={() => void windowAction("toggleMaximize")}
          aria-label={maximized ? "Restore" : "Maximize"}
          title={maximized ? "Restore" : "Maximize"}
          className="grid w-11 cursor-default place-items-center text-ink-soft hover:bg-hover-glass"
        >
          {maximized ? <WindowRestoreIcon /> : <WindowMaximizeIcon />}
        </button>
        <button
          type="button"
          onClick={() => void windowAction("close")}
          aria-label="Close"
          title="Close"
          className="grid w-11 cursor-default place-items-center text-ink-soft hover:bg-danger hover:text-white"
        >
          <WindowCloseIcon />
        </button>
      </div>

      {drag &&
        createPortal(
          <div
            data-tab-ghost
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              width: drag.width,
              height: drag.height,
              zIndex: 60,
              pointerEvents: "none",
              transform: `translate3d(${drag.x}px, ${drag.y}px, 0) scale(${drag.dropping ? 1 : 1.04}) rotate(${drag.dropping ? 0 : -1.2}deg)`,
              transition: drag.dropping
                ? "transform 190ms cubic-bezier(0.2, 0.8, 0.3, 1)"
                : "none",
              willChange: "transform",
            }}
            className={`${TAB_CHIP} shadow-panel`}
          >
            <span className="shrink-0 text-ink-dim">
              <RepoIcon size={12} />
            </span>
            <span className="min-w-0 flex-1 truncate">{drag.name}</span>
          </div>,
          document.body,
        )}
    </div>
  );
}
