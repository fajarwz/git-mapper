// Retakes the marketing screenshots from the real app and rebuilds every floating composition.
//   npm run shots            capture from the app, then render all outputs
//   npm run shots -- render  skip the capture, re-render from docs/media/sources
//   npm run shots -- video   render only the 8 s hero loop (transparent WebM for the site, MP4 for posts)
//   npm run shots -- social  render only the captioned social video (docs/media/social/social-video.mp4)
//   npm run shots -- features  retake and render only the per-feature images (docs/media/features)
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
const COMPOSE = pathToFileURL(join(MEDIA, "compose", "floating-screenshot.html")).href;
const FEATURES = pathToFileURL(join(MEDIA, "compose", "feature-floating.html")).href;

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

async function openApp(browser, repos, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await context.addInitScript((list) => {
    localStorage.setItem("git-mapper:open-repos", JSON.stringify(list));
    localStorage.setItem("git-mapper:active-repo", JSON.stringify(list[0]));
    localStorage.setItem("git-mapper:theme", "light");
    localStorage.setItem("git-mapper:update-mode", JSON.stringify("manual"));
    localStorage.setItem("git-mapper:star-prompt", JSON.stringify("dismissed"));
  }, repos);
  const page = await context.newPage();
  await page.goto(URL_APP);
  await page.getByRole("button", { name: "Open settings" }).waitFor();
  await sleep(2500);
  return page;
}

async function capture(browser) {
  for (const d of [join(SOURCES, "hero"), join(MEDIA, "hero"), join(MEDIA, "social")]) mkdirSync(d, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), "gm-shots-"));
  const repo = join(dir, "orbit-demo");
  const open = (width, height) => {
    execFileSync(process.execPath, [join(VIDEO, "scripts", "make-demo-repo.mjs"), repo], { stdio: "ignore" });
    return openApp(browser, [repo], width, height);
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
  await page.screenshot({ path: join(SOURCES, "hero", "stage.png") });
  await page.getByText("feature/dark-theme", { exact: true }).first().click({ button: "right" });
  await sleep(600);
  const m = await page.getByRole("menu").first().boundingBox();
  const pad = 14;
  await page.screenshot({ path: join(SOURCES, "hero", "menu.png"), clip: { x: m.x - pad, y: m.y - pad, width: m.width + pad * 2, height: m.height + pad * 2 } });
  await page.context().close();

  // Diff with two picked lines, in a narrow window so the diff panel is compact.
  page = await open(900, 800);
  await page.getByText("server.ts").first().click();
  await sleep(400);
  await page.getByLabel(/^Pick/).nth(0).click();
  await page.getByLabel(/^Pick/).nth(1).click();
  await rest(page);
  await page.screenshot({ path: join(SOURCES, "hero", "hunk-full.png") });
  await page.context().close();
}

// One window per feature, kept in docs/media/sources/features for feature-floating.html.
async function captureFeatures(browser, only) {
  const out = join(SOURCES, "features");
  mkdirSync(out, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), "gm-feat-"));
  const demo = (conflict) => {
    const repo = join(dir, conflict ? "c" : "n", "orbit-demo");
    execFileSync(process.execPath, [join(VIDEO, "scripts", "make-demo-repo.mjs"), repo], { stdio: "ignore" });
    if (conflict) {
      try {
        execFileSync("git", ["merge", "feature/dark-theme"], { cwd: repo, stdio: "ignore" });
      } catch {
        /* the conflict is the point */
      }
    }
    return repo;
  };
  const rest = (page) => page.mouse.move(5, 5).then(() => sleep(500));

  let page = await openApp(browser, [demo(true)], 1100, 760);
  await page.getByText("theme.ts").first().click();
  await sleep(800);
  await rest(page);
  await page.screenshot({ path: join(out, "conflict.png") });
  await page.context().close();

  page = await openApp(browser, [demo(false)], 1100, 760);
  await page.mouse.move(600, 400);
  await page.keyboard.press("Control+f");
  await sleep(500);
  await page.keyboard.type("search", { delay: 80 });
  await sleep(700);
  await page.screenshot({ path: join(out, "find.png") });
  await page.context().close();

  page = await openApp(browser, [demo(false)], 1100, 760);
  await rest(page);
  await page.screenshot({ path: join(out, "graph.png") });
  await page.context().close();

  page = await openApp(browser, [demo(false)], 1100, 760);
  await page.getByText("server.ts").first().click();
  await sleep(500);
  const picks = page.getByLabel(/^Pick/);
  for (let i = 0; i < Math.min(3, await picks.count()); i++) await picks.nth(i).click();
  await rest(page);
  await page.screenshot({ path: join(out, "lines.png") });
  await page.context().close();

  page = await openApp(browser, [demo(false)], 1100, 760);
  await page.getByText("feature/dark-theme", { exact: true }).first().click({ button: "right" });
  await sleep(600);
  await page.screenshot({ path: join(out, "pulls.png") });
  await page.context().close();

  page = await openApp(browser, [demo(false)], 1100, 760);
  await page.getByRole("button", { name: /^Stage metrics\.ts/ }).click();
  await sleep(300);
  await page.getByText("server.ts").first().click();
  await page.getByRole("button", { name: /^Uncommitted changes/ }).first().click();
  await sleep(500);
  await rest(page);
  await page.screenshot({ path: join(out, "stage.png") });
  await page.context().close();

  page = await openApp(browser, [demo(false)], 1100, 760);
  await page.getByRole("button", { name: /^Read the port from the environment/ }).first().click();
  await sleep(800);
  await page.getByText("Split", { exact: true }).first().click();
  await sleep(500);
  await rest(page);
  await page.screenshot({ path: join(out, "split.png") });
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
  await shoot("#full", { width: 2400, height: 1400 }, join(MEDIA, "hero", "floating-screenshot.png"));
  await shoot("#bare", { width: 2400, height: 1070 }, join(MEDIA, "hero", "floating-screenshot-bare.png"));
  const clear = join(MEDIA, "hero", "floating-screenshot-transparent.png");
  await shoot("#bare-clear", { width: 2400, height: 1070 }, clear, { transparent: true });
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", clear, "-c:v", "libwebp", "-quality", "88", "-pix_fmt", "yuva420p", join(SCREENS, "hero-floating.webp")]);
  for (const w of [800, 1600]) execFileSync("ffmpeg", ["-y", "-v", "error", "-i", clear, "-vf", `scale=${w}:-1:flags=lanczos`, "-c:v", "libwebp", "-quality", "88", "-pix_fmt", "yuva420p", join(SCREENS, `hero-floating-${w}.webp`)]);
  // Social preview: composed at 2400x1260, shot at half scale for 1200x630.
  await shoot("#og", { width: 2400, height: 1260 }, join(SCREENS, "og-image.png"), { scale: 0.5 });
  copyFileSync(join(SCREENS, "og-image.png"), join(MEDIA, "social", "og-image.png"));
}

const FEATURE_NAMES = ["conflict", "find", "lines", "graph", "pulls", "stage", "split"];

async function renderFeatures(browser) {
  const out = join(MEDIA, "features");
  mkdirSync(out, { recursive: true });
  for (const name of FEATURE_NAMES) {
    const context = await browser.newContext({ viewport: { width: 2400, height: 1350 }, deviceScaleFactor: 2 / 3 });
    const page = await context.newPage();
    await page.goto(FEATURES + "#" + name);
    await page.evaluate(() => document.fonts.ready);
    await sleep(400);
    const png = join(out, `${name}.png`);
    await page.screenshot({ path: png });
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", png, "-c:v", "libwebp", "-quality", "90", join(out, `${name}.webp`)]);
    await context.close();
  }
  // Website variants: no headline, transparent, 1600x767 + 800w WebP with alpha.
  const site = join(SCREENS, "features");
  mkdirSync(site, { recursive: true });
  for (const name of FEATURE_NAMES) {
    // Most images are 2400x1150 shot at 2/3 (1600 wide); the ones in the narrow side column set their own tighter canvas.
    const context = await browser.newContext({ viewport: { width: 2400, height: 1200 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(FEATURES + "#" + name + "-site");
    await page.evaluate(() => document.fonts.ready);
    await sleep(400);
    const size = await page.evaluate(() => ({ width: document.body.offsetWidth, height: document.body.offsetHeight }));
    await page.setViewportSize(size);
    await sleep(200);
    const png = join(site, `${name}.png`);
    await page.screenshot({ path: png, omitBackground: true });
    for (const [w, file] of [[1600, `${name}.webp`], [800, `${name}-800.webp`]]) {
      execFileSync("ffmpeg", ["-y", "-v", "error", "-i", png, "-vf", `scale=${Math.min(w, size.width)}:-1:flags=lanczos`, "-c:v", "libwebp", "-quality", "88", "-pix_fmt", "yuva420p", join(site, file)]);
    }
    rmSync(png);
    await context.close();
  }
}

const FPS = 30;
const SECONDS = 8;

async function video(browser, only) {
  const frames = mkdtempSync(join(tmpdir(), "gm-frames-"));
  const pass = async (hash, transparent, height = 1070, scale = 1) => {
    const context = await browser.newContext({ viewport: { width: 2400, height }, deviceScaleFactor: scale });
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
  execFileSync("ffmpeg", [...input, "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "38", "-auto-alt-ref", "0", join(SCREENS, "hero-floating.webm")]);
  await pass("#bare-motion", false);
  execFileSync("ffmpeg", [...input, "-c:v", "libx264", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(MEDIA, "hero", "floating-screenshot.mp4")]);
  }
  await pass("#og-motion", false, 1260, 0.8);
  execFileSync("ffmpeg", [...input, "-c:v", "libx264", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(MEDIA, "social", "social-video.mp4")]);
  rmSync(frames, { recursive: true, force: true });
}

const mode = process.argv[2];
const renderOnly = mode === "render" || mode === "video" || mode === "social";
const dev = renderOnly ? null : await ensureDevServer();
const browser = await launch();
try {
  if (mode === "video" || mode === "social") await video(browser, mode);
  else if (mode === "features") {
    await captureFeatures(browser);
    await renderFeatures(browser);
  } else {
    if (!renderOnly) {
      await capture(browser);
      await captureFeatures(browser);
    }
    await render(browser);
    await renderFeatures(browser);
  }
  console.log("done");
} finally {
  await browser.close();
  if (dev) {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(dev.pid), "/t", "/f"], { stdio: "ignore" });
    else dev.kill();
  }
}
