/**
 * Copy text to the clipboard. The async clipboard API is the clean path, but WebView2 can
 * deny it per-origin, so a hidden-textarea fallback (the legacy execCommand route) backs it
 * up. Returns whether a copy route reported success; callers may stay optimistic anyway.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }
}
