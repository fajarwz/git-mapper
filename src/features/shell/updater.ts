/**
 * The app updater, as a tiny subscribe store: the check/download lifecycle runs once in App
 * (auto on launch, or from the settings button), and every listener — the settings modal, the
 * settings-gear dot — sees the same phases.
 *
 * Inert outside a Tauri release build: dev sessions and browser tabs never check (dev builds
 * are not signed, so the updater would refuse them anyway).
 */
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdatePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface UpdateStatus {
  phase: UpdatePhase;
  version?: string;
  received?: number;
  total?: number | null;
  message?: string;
}

export const UPDATE_MODES = ["auto", "manual"] as const;
export type UpdateMode = (typeof UPDATE_MODES)[number];

export const GITHUB_URL = "https://github.com/fajarwz/git-mapper";

export function updaterSupported(): boolean {
  // Only "is this a Tauri window" — browser tabs have no updater. Dev builds stay out via a
  // DEV gate at the auto-check call site (App): they are unsigned, so a real check would just
  // error, but a manual click is allowed to try and show why.
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let current: Update | null = null;
let status: UpdateStatus = { phase: updaterSupported() ? "idle" : "unsupported" };
const listeners = new Set<(status: UpdateStatus) => void>();

function set(next: UpdateStatus): void {
  status = next;
  for (const listener of listeners) listener(status);
}

export function updateStatusSnapshot(): UpdateStatus {
  return status;
}

export function onUpdateStatus(listener: (status: UpdateStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function checkForUpdates(mode: UpdateMode): Promise<void> {
  if (!updaterSupported()) return;
  set({ phase: "checking" });
  try {
    current = await check();
    if (!current) {
      set({ phase: "current" });
      return;
    }
    if (mode === "auto") {
      await downloadUpdate();
    } else {
      set({ phase: "available", version: current.version });
    }
  } catch (error) {
    set({ phase: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

export async function downloadUpdate(): Promise<void> {
  if (!current) return;
  const version = current.version;
  let received = 0;
  let total: number | null = null;
  let lastTick = 0;
  set({ phase: "downloading", version, received: 0, total });
  try {
    await current.download((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        const now = Date.now();
        if (now - lastTick > 500) {
          lastTick = now;
          set({ phase: "downloading", version, received, total });
        }
      }
    });
    set({ phase: "ready", version });
  } catch (error) {
    set({ phase: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Installs the downloaded update, then relaunches. Windows cannot replace a running exe, so
 * there the installer closes the app itself and relaunch is never reached.
 */
export async function restartToUpdate(): Promise<void> {
  if (current) await current.install();
  await relaunch();
}
