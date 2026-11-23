// Retakes the marketing screenshots from the real app and rebuilds every floating composition.
//   npm run shots            capture from the app, then render all outputs
//   npm run shots -- render  skip the capture, re-render from docs/media/sources
//   npm run shots -- video   render only the 8 s hero loop (transparent WebM for the site, MP4 for posts)
//   npm run shots -- social  render only the captioned social video (docs/media/social-video.mp4)
// Starts `npm run dev` in the repo root itself when nothing answers on :1420. Needs Edge or Chrome and ffmpeg.
import { chromium } from "playwright-core";
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { VIDEO, URL_APP, sleep } from "./record/lib.mjs";

const ROOT = resolve(VIDEO, "..");
const MEDIA = join(ROOT, "docs", "media");
const SOURCES = join(MEDIA, "sources");
const SCREENS = join(ROOT, "website", "public", "screens");
const COMPOSE = pathToFileURL(join(MEDIA, "floating-screenshot.html")).href;

const launch = async () => {
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel, args: ["--hide-scrollbars", "--allow-file-access-from-files"] });
    } catch {
      /* try the next browser */
    }
  }
  throw new Error("Neither Edge nor Chrome could be launched");
};

async function ensureDevServer() {
  const up = () => fetch(URL_APP).then((r) => r.ok, () => false);
  if (await up()) return null;
  const dev = spawn("npm", ["run", "dev"], { cwd: ROOT, shell: true, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(1000);
  if (!(await up())) throw new Error("dev server did not start on :1420");
  return dev;
}

async function capture(browser) {
  mkdirSync(SOURCES, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), "gm-shots-"));
  const repo = join(dir, "orbit-demo");
  const open = async (width, height) => {
    execFileSync(process.execPath, [join(VIDEO, "scripts", "make-demo-repo.mjs"), repo], { stdio: "ignore" });
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    await context.addInitScript((r) => {
      localStorage.setItem("git-mapper:open-repos", JSON.stringify([r]));
      localStorage.setItem("git-mapper:active-repo", JSON.stringify(r));
      localStorage.setItem("git-mapper:theme", "light");
      localStorage.setItem("git-mapper:update-mode", JSON.stringify("manual"));
      localStorage.setItem("git-mapper:star-prompt", JSON.stringify("dismissed"));
    }, repo);
    const page = await context.newPage();
    await page.goto(URL_APP);
    await page.getByRole("button", { name: "Open settings" }).waitFor();
    await sleep(2500);
    return page;
  };
  const rest = (page) => page.mouse.move(5, 5).then(() => sleep(500));

  // Stage view and the branch context menu.
  let page = await open(1100, 760);
  await page.getByRole("button", { name: /^Stage metrics\.ts/ }).click();
  await sleep(300);
  await page.getByText("server.ts").first().click();
  await page.getByRole("button", { name: /^Uncommitted changes/ }).first().click();
  await sleep(500);
  await rest(page);
  await page.screenshot({ path: join(SOURCES, "stage.png") });
  await page.getByText("feature/dark-theme", { exact: true }).first().click({ button: "right" });
  await sleep(600);
  const m = await page.getByRole("menu").first().boundingBox();
  const pad = 14;
  await page.screenshot({ path: join(SOURCES, "menu.png"), clip: { x: m.x - pad, y: m.y - pad, width: m.width + pad * 2, height: m.height + pad * 2 } });
  await page.context().close();

  // Diff with two picked lines, in a narrow window so the diff panel is compact.
  page = await open(900, 800);
  await page.getByText("server.ts").first().click();
  await sleep(400);
  await page.getByLabel(/^Pick/).nth(0).click();
  await page.getByLabel(/^Pick/).nth(1).click();
  await rest(page);
  await page.screenshot({ path: join(SOURCES, "hunk-full.png") });
  await page.context().close();
}

async function render(browser) {
  const shoot = async (hash, size, out, { scale = 1, transparent = false } = {}) => {
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: scale });
    const page = await context.newPage();
    await page.goto(COMPOSE + hash);
    await page.evaluate(() => document.fonts.ready);
    await sleep(300);
    await page.screenshot({ path: out, omitBackground: transparent });
    await context.close();
  };
  await shoot("#full", { width: 2400, height: 1400 }, join(MEDIA, "floating-screenshot.png"));
  await shoot("#bare", { width: 2400, height: 1070 }, join(MEDIA, "floating-screenshot-bare.png"));
  const clear = join(MEDIA, "floating-screenshot-transparent.png");
  await shoot("#bare-clear", { width: 2400, height: 1070 }, clear, { transparent: true });
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", clear, "-c:v", "libwebp", "-quality", "88", "-pix_fmt", "yuva420p", join(SCREENS, "hero-floating.webp")]);
  // Social preview: composed at 2400x1260, shot at half scale for 1200x630.
  await shoot("#og", { width: 2400, height: 1260 }, join(SCREENS, "og-image.png"), { scale: 0.5 });
  copyFileSync(join(SCREENS, "og-image.png"), join(MEDIA, "og-image.png"));
}

const FPS = 30;
const SECONDS = 8;

async function video(browser, only) {
  const frames = mkdtempSync(join(tmpdir(), "gm-frames-"));
  const pass = async (hash, transparent, height = 1070) => {
    const context = await browser.newContext({ viewport: { width: 2400, height }, deviceScaleFactor: 2 / 3 });
    const page = await context.newPage();
    await page.goto(COMPOSE + hash);
    await page.evaluate(() => document.fonts.ready);
    for (let i = 0; i < FPS * SECONDS; i++) {
      await page.evaluate((ms) => window.seek(ms), (i / FPS) * 1000);
      await page.screenshot({ path: join(frames, `f${String(i).padStart(4, "0")}.png`), omitBackground: transparent });
    }
    await context.close();
  };
  const input = ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(frames, "f%04d.png")];
  if (only !== "social") {
  await pass("#bare-clear-motion", true);
  execFileSync("ffmpeg", [...input, "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "34", "-auto-alt-ref", "0", join(SCREENS, "hero-floating.webm")]);
  await pass("#bare-motion", false);
  execFileSync("ffmpeg", [...input, "-vf", "crop=1600:712:0:0", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(MEDIA, "floating-screenshot.mp4")]);
  }
  await pass("#og-motion", false, 1260);
  execFileSync("ffmpeg", [...input, "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(MEDIA, "social-video.mp4")]);
  rmSync(frames, { recursive: true, force: true });
}

const mode = process.argv[2];
const renderOnly = mode === "render" || mode === "video" || mode === "social";
const dev = renderOnly ? null : await ensureDevServer();
const browser = await launch();
try {
  if (mode === "video" || mode === "social") await video(browser, mode);
  else {
    if (!renderOnly) await capture(browser);
    await render(browser);
  }
  console.log("done");
} finally {
  await browser.close();
  if (dev) {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(dev.pid), "/t", "/f"], { stdio: "ignore" });
    else dev.kill();
  }
}
