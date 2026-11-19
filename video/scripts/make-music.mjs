// Synthesizes an original instrumental loop (no samples, no voice) so there is nothing to license or credit.
// Usage: node scripts/make-music.mjs  -> assets/music.wav, then ffmpeg turns it into assets/music.mp3
import { execFileSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SR = 44100;
const BPM = 124;
const BEAT = 60 / BPM;
const DURATION = 28;
const N = Math.floor(DURATION * SR);
const L = new Float32Array(N);
const R = new Float32Array(N);

const midi = (m) => 440 * 2 ** ((m - 69) / 12);
// Am - F - C - G, one bar each
const CHORDS = [
  { root: 45, tones: [57, 60, 64, 67] },
  { root: 41, tones: [53, 57, 60, 65] },
  { root: 48, tones: [55, 60, 64, 67] },
  { root: 43, tones: [55, 59, 62, 67] },
];

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function add(start, samples, gainL, gainR = gainL) {
  const s0 = Math.floor(start * SR);
  for (let i = 0; i < samples.length; i++) {
    const k = s0 + i;
    if (k >= N) break;
    L[k] += samples[i] * gainL;
    R[k] += samples[i] * gainR;
  }
}

function kick() {
  const len = Math.floor(0.28 * SR);
  const out = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * (48 + 110 * Math.exp(-t * 28))) / SR;
    out[i] = Math.sin(phase) * Math.exp(-t * 11);
  }
  return out;
}

function hat(open) {
  const len = Math.floor((open ? 0.16 : 0.05) * SR);
  const out = new Float32Array(len);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const n = rand();
    const hp = n - prev;
    prev = n;
    out[i] = hp * Math.exp((-i / SR) * (open ? 22 : 70));
  }
  return out;
}

function clap() {
  const len = Math.floor(0.2 * SR);
  const out = new Float32Array(len);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    lp += (rand() - lp) * 0.35;
    const burst = [0, 0.012, 0.024].reduce((a, d) => a + (t >= d ? Math.exp(-(t - d) * 60) : 0), 0);
    out[i] = lp * burst * 0.6 + lp * Math.exp(-t * 18) * 0.4;
  }
  return out;
}

function pluck(freq, dur) {
  const len = Math.floor(dur * SR);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.min(1, t * 400) * Math.exp(-t * 7);
    out[i] = (Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(4 * Math.PI * freq * t) * Math.exp(-t * 10)) * env;
  }
  return out;
}

function bass(freq, dur) {
  const len = Math.floor(dur * SR);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.min(1, t * 200) * Math.exp(-t * 4.5);
    const saw = 2 * ((freq * t) % 1) - 1;
    out[i] = (Math.sin(2 * Math.PI * freq * t) * 0.8 + saw * 0.25) * env;
  }
  return out;
}

function pad(freqs, dur) {
  const len = Math.floor(dur * SR);
  const out = new Float32Array(len);
  for (const f of freqs) {
    for (const det of [-0.004, 0.004]) {
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const saw = 2 * ((f * (1 + det) * t) % 1) - 1;
        lp += (saw - lp) * 0.04;
        const env = Math.min(1, t * 3) * Math.min(1, (dur - t) * 4);
        out[i] += lp * env * 0.07;
      }
    }
  }
  return out;
}

const bars = Math.ceil(DURATION / (BEAT * 4));
const kickS = kick();
const clapS = clap();
for (let bar = 0; bar < bars; bar++) {
  const chord = CHORDS[bar % CHORDS.length];
  const t0 = bar * BEAT * 4;
  const drums = bar >= 1 && t0 < DURATION - 3;
  add(t0, pad(chord.tones.map(midi), BEAT * 4), 0.9, 0.9);

  for (let step = 0; step < 16; step++) {
    const t = t0 + step * (BEAT / 4);
    const note = chord.tones[[0, 2, 1, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2][step]] + 12;
    const pan = 0.5 + 0.35 * Math.sin(step * 0.9);
    add(t, pluck(midi(note), 0.35), 0.16 * (1 - pan) + 0.05, 0.16 * pan + 0.05);
    add(t + BEAT * 0.75, pluck(midi(note), 0.3), 0.05 * pan, 0.05 * (1 - pan));
    if (drums) {
      if (step % 4 === 0) add(t, kickS, 0.7);
      if (step % 4 === 2) add(t, hat(step % 8 === 6), 0.1, 0.12);
      if (step % 2 === 1) add(t, hat(false), 0.05, 0.06);
      if (step === 4 || step === 12) add(t, clapS, 0.22);
    }
    if (bar >= 1 && [0, 3, 6, 8, 11, 14].includes(step)) add(t, bass(midi(chord.root), BEAT / 2), 0.42);
  }
}

// soft clip, fades, peak normalise
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = Math.min(1, t / 0.4) * Math.min(1, (DURATION - t) / 2.2);
  L[i] = Math.tanh(L[i] * 1.4) * fade;
  R[i] = Math.tanh(R[i] * 1.4) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.85 / peak;

const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(L[i] * norm * 32767), i * 4);
  data.writeInt16LE(Math.round(R[i] * norm * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

mkdirSync(resolve(root, "assets"), { recursive: true });
const wav = resolve(root, "assets/music.wav");
writeFileSync(wav, Buffer.concat([header, data]));
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "160k", resolve(root, "assets/music.mp3")]);
unlinkSync(wav);
console.log("wrote assets/music.mp3");
