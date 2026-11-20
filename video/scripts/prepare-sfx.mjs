// Cuts the Pixabay source sounds in assets/sfx-src into the clips the video plays (assets/sfx/*.wav):
// one mouse click, four slightly different key taps, a space and a heavier Ctrl+Enter.
// Usage: node scripts/prepare-sfx.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "assets", "sfx");
mkdirSync(out, { recursive: true });
const SR = 44100;

function decode(name) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", resolve(root, "assets", "sfx-src", name), "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

/** Seconds [from, to) of the source, played `pitch` times faster (which also raises the pitch). */
function cut(src, from, to, pitch = 1, tail = 0.015) {
  const n = Math.floor(((to - from) * SR) / pitch);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = from * SR + i * pitch;
    const k = Math.floor(p);
    buf[i] = (src[k] ?? 0) * (1 - (p - k)) + (src[k + 1] ?? 0) * (p - k);
  }
  const fade = Math.floor(tail * SR);
  for (let i = 0; i < Math.min(fade, n); i++) buf[n - 1 - i] *= i / fade;
  return buf;
}

function save(name, buf, peak) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const pcm = Buffer.alloc(buf.length * 2);
  buf.forEach((v, i) => pcm.writeInt16LE(Math.round((v / max) * peak * 32767), i * 2));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(SR, 24);
  head.writeUInt32LE(SR * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(pcm.length, 40);
  writeFileSync(resolve(out, `${name}.wav`), Buffer.concat([head, pcm]));
}

const mouse = decode("mouse-click.mp3");
const space = decode("spacebar-click.mp3");

// Mouse: the press and release, from just before the first transient to just after the second.
save("click", cut(mouse, 0.135, 0.3), 0.8);
// Keys: the press of the spacebar sample only (fast typing), nudged in pitch so taps differ.
[1, 1.05, 0.95, 1.1].forEach((pitch, i) => save(`key${i + 1}`, cut(space, 0.05, 0.14, pitch, 0.02), 0.7));
// Space: the full press and release. Ctrl+Enter: the same, lower and slower for weight.
save("space", cut(space, 0.05, 0.24, 0.9), 0.75);
save("chord", cut(space, 0.05, 0.24, 0.8), 0.85);

console.log(`wrote ${out}`);
