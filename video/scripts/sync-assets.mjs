// Copies the recorded clips, sound effects, music, logo and fonts into public/ so the video always shows what ships.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const video = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(video, "..");
const pub = resolve(video, "public");

const copies = [
  ["docs/assets/brand/logo.svg", "logo.svg"],
  ["public/fonts/plus-jakarta-sans.woff2", "fonts/plus-jakarta-sans.woff2"],
  ["public/fonts/jetbrains-mono.woff2", "fonts/jetbrains-mono.woff2"],
];
for (const n of readdirSync(resolve(video, "assets/clips"))) if (n.endsWith(".mp4")) copies.push([`video/assets/clips/${n}`, `clips/${n}`]);
for (const n of readdirSync(resolve(video, "assets/sfx"))) copies.push([`video/assets/sfx/${n}`, `sfx/${n}`]);
copies.push(["video/assets/music.mp3", "music.mp3"]);

for (const [from, to] of copies) {
  const dest = resolve(pub, to);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(resolve(repo, from), dest);
}
console.log(`synced ${copies.length} files`);
