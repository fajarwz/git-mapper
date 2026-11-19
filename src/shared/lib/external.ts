import { openUrl } from "@tauri-apps/plugin-opener";

export function openExternal(url: string) {
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (inTauri) void openUrl(url);
  else window.open(url, "_blank", "noopener");
}
