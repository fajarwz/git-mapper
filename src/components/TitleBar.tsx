import { useEffect, useRef, useState } from "react";
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
  const dragRef = useRef<{ index: number; startX: number; moving: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  function beginTabDrag(event: React.PointerEvent<HTMLDivElement>, index: number) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button[aria-label^='Close']")) return;
    suppressClick.current = false;
    dragRef.current = { index, startX: event.clientX, moving: false };

    const onMove = (moveEvent: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.moving) {
        // A few pixels of slack so a plain click stays a click.
        if (Math.abs(moveEvent.clientX - drag.startX) < 4) return;
        drag.moving = true;
        setDraggingIndex(drag.index);
      }
      const strip = stripRef.current;
      if (!strip) return;
      const tabs = [...strip.querySelectorAll<HTMLElement>("[data-tab-index]")];
      const over = tabs.findIndex((tab) => {
        const rect = tab.getBoundingClientRect();
        return moveEvent.clientX >= rect.left && moveEvent.clientX <= rect.right;
      });
      if (over === -1 || over === drag.index) return;
      onReorder(drag.index, over);
      drag.index = over;
      setDraggingIndex(over);
    };

    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDraggingIndex(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // The click that follows a drag must not also select the tab it started on.
      if (drag?.moving) suppressClick.current = true;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

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
          const dragging = draggingIndex === index;
          return (
            <div
              key={item.id}
              data-active={active}
              data-tab-index={index}
              data-dragging={dragging}
              onPointerDown={(event) => beginTabDrag(event, index)}
              style={{ flex: "1 1 200px", minWidth: 68, maxWidth: 200 }}
              className={`inline-flex h-7 min-w-0 items-center gap-1 rounded-lg border border-transparent bg-glass-soft pl-2.5 text-left text-ink-soft backdrop-blur-md transition-colors hover:bg-hover-glass data-[active=true]:border-hairline data-[active=true]:bg-glass-strong data-[active=true]:text-ink data-[active=true]:soft-shadow ${dragging ? "opacity-60 ring-2 ring-primary/50" : ""}`}
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
                className="flex h-full min-w-0 flex-1 cursor-default items-center gap-1.5 bg-transparent p-0 pr-1 text-left text-inherit"
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
    </div>
  );
}
