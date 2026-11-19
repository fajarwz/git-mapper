// Copies the app's own screenshots, logo and fonts into public/ so the video always shows what ships.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const video = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(video, "..");
const pub = resolve(video, "public");

const copies = [
  ["docs/assets/screenshots/main-dark.png", "shots/main-dark.png"],
  ["docs/assets/screenshots/main-light.png", "shots/main-light.png"],
  ...["graph", "split", "stage", "hunk", "conflict"].map((n) => [`website/src/assets/screens/${n}.png`, `shots/${n}.png`]),
  ["docs/assets/logo.svg", "logo.svg"],
  ["public/fonts/plus-jakarta-sans.woff2", "fonts/plus-jakarta-sans.woff2"],
  ["public/fonts/jetbrains-mono.woff2", "fonts/jetbrains-mono.woff2"],
];
for (const n of ["findbar", "switcher", "branch-menu", "settings"]) copies.push([`video/assets/${n}.png`, `shots/${n}.png`]);
copies.push(["video/assets/music.mp3", "music.mp3"]);

for (const [from, to] of copies) {
  const dest = resolve(pub, to);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(resolve(repo, from), dest);
}
console.log(`synced ${copies.length} files`);
