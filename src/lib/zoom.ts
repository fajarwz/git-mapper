import { getCurrentWebview } from "@tauri-apps/api/webview";

import { STORAGE_KEYS } from "./persisted";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

const round = (value: number) => Math.round(value * 100) / 100;

/** One step in or out; `reset` returns to 100%. Clamped, and rounded so 0.1 steps never drift. */
export function nextZoom(current: number, action: "in" | "out" | "reset"): number {
  if (action === "reset") return 1;
  const next = round(current + (action === "in" ? ZOOM_STEP : -ZOOM_STEP));
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

/** The shortcut a keydown stands for (Ctrl/Cmd + = + - 0), or null. */
export function zoomAction(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (event.key === "=" || event.key === "+") return "in";
  if (event.key === "-" || event.key === "_") return "out";
  if (event.key === "0") return "reset";
  return null;
}

function readZoom(): number {
  try {
    const stored = Number(JSON.parse(localStorage.getItem(STORAGE_KEYS.zoom) ?? "1"));
    return Number.isFinite(stored) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stored)) : 1;
  } catch {
    return 1;
  }
}

/** Whole-window zoom like VS Code: Ctrl/Cmd +, -, 0 and Ctrl + wheel, remembered across launches.
 * The native webview zoom is used (not CSS zoom), so layout, the title bar and px maths agree. */
export function installZoom(): void {
  if (!("__TAURI_INTERNALS__" in window)) return; // the browser tab has its own zoom
  let zoom = readZoom();
  const apply = (next: number) => {
    zoom = next;
    try {
      localStorage.setItem(STORAGE_KEYS.zoom, JSON.stringify(zoom));
    } catch {
      /* zoom still applies for this session */
    }
    void getCurrentWebview().setZoom(zoom);
  };

  if (zoom !== 1) void getCurrentWebview().setZoom(zoom);

  document.addEventListener("keydown", (event) => {
    const action = zoomAction(event);
    if (!action) return;
    event.preventDefault();
    apply(nextZoom(zoom, action));
  });
  document.addEventListener(
    "wheel",
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;
      event.preventDefault();
      apply(nextZoom(zoom, event.deltaY < 0 ? "in" : "out"));
    },
    { passive: false },
  );
}
