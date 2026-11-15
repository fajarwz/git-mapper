import { openUrl } from "@tauri-apps/plugin-opener";

/** Opens a URL in the system browser; a plain browser tab (dev) falls back to window.open. */
export function openExternal(url: string) {
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (inTauri) void openUrl(url);
  else window.open(url, "_blank", "noopener");
}
