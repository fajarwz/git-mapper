// Drives the real app in headless Chromium and records it frame by frame (CDP screencast, JPEG q95)
// so text stays sharp. A cursor and key badges are drawn inside the page, so they are in the frames.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VIDEO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WORK = join(tmpdir(), "gm-showcase");
export const CLIPS = join(VIDEO, "assets", "clips");
export const URL_APP = "http://localhost:1420";
export const SIZE = { width: 1600, height: 1000 };
export const FPS = 30;

const CHROMIUM = (() => {
  const root = join(process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), "AppData", "Local", "ms-playwright"));
  const found = ["chromium-1140", "chromium-1148", "chromium-1155"].map((d) => join(root, d, "chrome-win", "chrome.exe")).find(existsSync);
  return found;
})();

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fresh copy of the demo repo (a scene may commit, stage or merge in it). */
export function demoRepo(name = "orbit") {
  const dir = join(WORK, name);
  execFileSync(process.execPath, [join(VIDEO, "scripts", "make-demo-repo.mjs"), dir], { stdio: "ignore" });
  return dir;
}

/** A small extra repo, used to fill the tab strip. */
export function tinyRepo(name, subjects) {
  const dir = join(WORK, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.name", "Maya Chen");
  g("config", "user.email", "maya@orbit.dev");
  subjects.forEach((s, i) => {
    writeFileSync(join(dir, `file${i}.txt`), `${s}\n`);
    g("add", "-A");
    g("commit", "-q", "-m", s);
  });
  return dir;
}

export const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const OVERLAY = () => {
  const style = document.createElement("style");
  style.textContent = `
    #gm-cursor{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;transform-origin:0 0;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35));transition:transform .09s}
    #gm-cursor.down{transform:scale(.82)}
    .gm-ripple{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid #6e56cf;animation:gm-r .55s ease-out forwards}
    @keyframes gm-r{to{transform:scale(4.2);opacity:0}}
    #gm-keys{position:fixed;right:34px;bottom:34px;z-index:2147483647;pointer-events:none;display:flex;gap:8px;padding:12px 18px;border-radius:16px;background:rgba(23,21,31,.92);box-shadow:0 14px 40px rgba(0,0,0,.4);opacity:0;transform:translateY(10px) scale(.92);transition:opacity .18s,transform .18s}
    #gm-keys.on{opacity:1;transform:none}
    #gm-keys kbd{font:700 22px/1 'Plus Jakarta Sans',system-ui,sans-serif;color:#f4f2fb;min-width:42px;height:42px;display:inline-flex;align-items:center;justify-content:center;padding:0 12px;border-radius:10px;background:rgba(255,255,255,.1);border:1.5px solid rgba(255,255,255,.22);border-bottom-width:4px}
  `;
  const cursor = document.createElement("div");
  cursor.id = "gm-cursor";
  cursor.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.5L9 19z" fill="#fff" stroke="#17151f" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const keys = document.createElement("div");
  keys.id = "gm-keys";
  const mount = () => {
    document.head.append(style);
    document.body.append(cursor, keys);
    cursor.style.left = "-60px";
  };
  if (document.body) mount();
  else addEventListener("DOMContentLoaded", mount);
  addEventListener("mousemove", (e) => { cursor.style.left = e.clientX + "px"; cursor.style.top = e.clientY + "px"; }, true);
  addEventListener("mousedown", (e) => {
    cursor.classList.add("down");
    const r = document.createElement("div");
    r.className = "gm-ripple";
    r.style.left = e.clientX + "px";
    r.style.top = e.clientY + "px";
    document.body.append(r);
    setTimeout(() => r.remove(), 600);
  }, true);
  addEventListener("mouseup", () => cursor.classList.remove("down"), true);
  window.__gmKeys = (list, ms) => {
    keys.innerHTML = list.map((k) => `<kbd>${k}</kbd>`).join("");
    keys.classList.add("on");
    clearTimeout(window.__gmKeysT);
    window.__gmKeysT = setTimeout(() => keys.classList.remove("on"), ms);
  };
};

/**
 * Records one clip. `setup(ctx)` runs before the page opens (git state, localStorage values);
 * `scene(a)` is the scripted interaction and gets the actor helpers below.
 */
export async function record(name, { repos, theme = "dark", active, setup, scene }) {
  mkdirSync(CLIPS, { recursive: true });
  const frames = join(WORK, `frames-${name}`);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const info = (await setup?.()) ?? {};
  const paths = repos ?? info.repos;

  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${SIZE.width},${SIZE.height}`] });
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
  await context.addInitScript(([list, act, th]) => {
    localStorage.setItem("git-mapper:open-repos", JSON.stringify(list));
    localStorage.setItem("git-mapper:active-repo", JSON.stringify(act));
    localStorage.setItem("git-mapper:theme", th);
    localStorage.setItem("git-mapper:update-mode", JSON.stringify("manual"));
    localStorage.setItem("git-mapper:star-prompt", JSON.stringify("dismissed"));
  }, [paths, active ?? paths[0], theme]);
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));
  await page.goto(URL_APP);
  await page.getByRole("button", { name: "Open settings" }).waitFor();
  await sleep(3000);

  const cdp = await context.newCDPSession(page);
  const shots = [];
  // Without this the screencast is limited to the machine's screen (about 1584x905) and the bottom of the app is cut off.
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: SIZE.width, height: SIZE.height, deviceScaleFactor: 1, mobile: false, screenWidth: SIZE.width, screenHeight: SIZE.height });
  let wrongSize = null;
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    if (metadata.deviceWidth !== SIZE.width || metadata.deviceHeight !== SIZE.height) wrongSize = `${metadata.deviceWidth}x${metadata.deviceHeight}`;
    shots.push({ t: metadata.timestamp, data });
    void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, everyNthFrame: 2, maxWidth: SIZE.width, maxHeight: SIZE.height });

  const events = [];
  const a = actor(page, events);
  await sleep(700);
  try {
    await scene(a, info);
  } finally {
    await sleep(900);
    await cdp.send("Page.stopScreencast").catch(() => {});
    await page.screenshot({ path: join(WORK, `${name}-last.png`) });
    await browser.close();
  }

  if (wrongSize) throw new Error(`${name}: screencast frames were ${wrongSize}, not ${SIZE.width}x${SIZE.height}`);

  // Frames carry timestamps; turn them into a constant-rate clip.
  const list = [];
  shots.forEach((s, i) => {
    const file = join(frames, `f${String(i).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(s.data, "base64"));
    const next = shots[i + 1]?.t ?? s.t + 0.5;
    list.push(`file '${file.replace(/\\/g, "/")}'`, `duration ${Math.max(0.001, next - s.t).toFixed(4)}`);
  });
  list.push(`file '${join(frames, `f${String(shots.length - 1).padStart(5, "0")}.jpg`).replace(/\\/g, "/")}'`);
  const listFile = join(frames, "list.txt");
  writeFileSync(listFile, list.join("\n"));
  const out = join(CLIPS, `${name}.mp4`);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", `fps=${FPS},scale=${SIZE.width}:${SIZE.height}`, "-c:v", "libx264", "-crf", "17", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "inherit" });
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" }).trim());
  rmSync(frames, { recursive: true, force: true });
  console.log(`${name}: ${seconds.toFixed(1)}s, ${shots.length} frames`);
  const t0 = shots[0].t;
  return { name, frames: Math.round(seconds * FPS), events: events.map((e) => [Math.max(0, Math.round((e.at - t0) * FPS)), e.k]) };
}

function actor(page, events) {
  const mark = (k) => events.push({ at: Date.now() / 1000, k });
  let pos = { x: 800, y: 500 };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const api = {
    page,
    hold: sleep,
    async moveTo(x, y, ms = 480) {
      const steps = Math.max(8, Math.round(ms / 16));
      const from = pos;
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps);
        await page.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
        await sleep(ms / steps);
      }
      pos = { x, y };
    },
    async point(locator, { dx = 0, dy = 0, ms = 480 } = {}) {
      const box = await locator.first().boundingBox();
      if (!box) throw new Error(`no box for ${locator}`);
      await api.moveTo(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, ms);
      return box;
    },
    async click(locator, opts = {}) {
      await api.point(locator, opts);
      await sleep(120);
      await page.mouse.down();
      mark("click"); // logged once the browser has taken the press, not when it was requested
      await sleep(70);
      await page.mouse.up();
      await sleep(opts.after ?? 320);
    },
    async rightClick(locator, opts = {}) {
      await api.point(locator, opts);
      await sleep(120);
      await page.mouse.click(pos.x, pos.y, { button: "right" });
      mark("click");
      await sleep(opts.after ?? 600);
    },
    async type(text, delay = 75) {
      for (const ch of text) {
        await page.keyboard.type(ch);
        mark(ch === " " ? "space" : "key");
        await sleep(delay);
      }
      await sleep(250);
    },
    /** Presses a chord and flashes the key badge. */
    async press(label, combo, { after = 500, badge = 1700 } = {}) {
      await page.evaluate(([l, ms]) => window.__gmKeys(l, ms), [label, badge]);
      await sleep(260);
      await page.keyboard.press(combo);
      mark("chord");
      await sleep(after);
    },
    async wheel(dy, steps = 8, each = 40) {
      for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(0, dy / steps);
        await sleep(each);
      }
      await sleep(300);
    },
  };
  return api;
}
