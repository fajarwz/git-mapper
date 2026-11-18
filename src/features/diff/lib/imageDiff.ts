/**
 * Image files get GitHub's picture diff instead of line rows: the previous and current blobs
 * side by side (plus swipe / onion-peel overlays), with pixel dimensions and byte sizes.
 * Routing is by extension, the same signal `image_mime` uses on the Rust side.
 */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
  "apng",
]);

export function isImageFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return IMAGE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/** GitHub-style size captions: "12 B", "45.3 KB", "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value >= 10 || unit === 0 ? Math.round(value).toString() : value.toFixed(1);
  return `${text} ${units[unit]}`;
}
