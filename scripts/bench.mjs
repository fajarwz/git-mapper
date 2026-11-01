#!/usr/bin/env node
// bench.mjs — simple perf probe for a packaged Git Mapper build.
// Everything measured is real and comes out of the app's own boot path:
//   1. cold start   — ms from process spawn until the commit list shows rows
//   2. idle RAM     — private bytes of the shell + its WebView2 content processes
//   3. cost per tab — idle RAM with 1 tab vs 5 tabs open
//
// usage: node scripts/bench.mjs "<exe>" <repoPath> [repoPath2 ... repoPath5]
// Needs Node >= 22 (global WebSocket). Kills only the Git Mapper app itself.
//
// Seeding tabs: the app restores its tabs from git-mapper:open-repos in
// localStorage. The packaged origin must never be reloaded (WebView2 turns a
// custom-protocol reload into the dead "unreachable" screen — the app's own
// startup guard exists for that), so seeding and measuring are separate
// launches: launch #1 writes the seed and exits; later launches restore
// from disk through the app's normal restore path.

import { spawn, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const [exePath, ...repos] = process.argv.slice(2);
if (!exePath || repos.length === 0) {
  console.error('usage: node scripts/bench.mjs "<exe>" <repoPath> [...up to 5 repoPaths]');
  process.exit(1);
}
const PORT = 9333 + (process.pid % 5000);

const run = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString();

/** JSON over WebSocket, one command at a time. */
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, err) => ((ws.onopen = ok), (ws.onerror = err)));
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d.result?.result?.value ?? d.result);
      pending.delete(d.id);
    }
  };
  return {
    async call(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function waitDebugger(ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not listening yet */ }
    await sleep(200);
  }
  throw new Error("remote debugging never came up");
}

/** True once evaluate says we are on the real app origin, not the boot page. */
async function onAppPage(cdp) {
  const url = await cdp.call("Runtime.evaluate", {
    expression: "location.href",
    returnByValue: true,
  });
  return typeof url === "string" && url.includes("tauri.localhost");
}

async function waitAppPage(cdp, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await onAppPage(cdp)) return true;
    await sleep(200);
  }
  throw new Error("tauri page never appeared");
}

/** Private memory of the app shell + its WebView2 children, in MB. */
function idleRamMB() {
  // Private bytes only (working set double-counts pages shared with every Edge
  // process); matching webview leaves via _ram.ps1 — inline PS quoting across
  // two escaping generations was unmaintainable.
  const out = run(`powershell -NoProfile -File "${process.cwd()}/scripts/_ram.ps1"`).trim();
  return (Number(out) || 0) / 1024 / 1024;
}

function killApp() {
  run("taskkill /IM git-mapper.exe /F 2>NUL & exit 0");
  // webview leaves whose command line points at this app's data dir only
  try {
    run(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='msedgewebview2.exe'\\" | Where-Object { $_.CommandLine -like '*git-mapper*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" 2>NUL`
    );
  } catch { /* nothing to kill */ }
}

function launch() {
  return spawn(exePath, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  });
}

/** Launch just to write the tab list into localStorage on the app origin. */
async function seed(repoPaths) {
  killApp();
  await sleep(1500);
  const child = launch();
  const cdp = await connect(await waitDebugger());
  await waitAppPage(cdp);
  await cdp.call("Runtime.evaluate", {
    expression: `localStorage.setItem("git-mapper:open-repos", ${JSON.stringify(JSON.stringify(repoPaths))});
      localStorage.setItem("git-mapper:theme", "light");
      true`,
    returnByValue: true,
  });
  await cdp.close();
  child.kill();
  killApp();
  console.log(`seeded ${repoPaths.length} tab(s)`);
}

/** The measured run: untouched boot -> rows on screen -> settled idle RAM. */
async function oneRun() {
  killApp();
  await sleep(1500);
  const t0 = Date.now();
  const child = launch();
  let tDebugger = null;
  let tAppPage = null;
  let bootMs = null;
  let wsUrl = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      if (wsUrl === null) {
        wsUrl = await waitDebugger(2000);
        if (tDebugger === null) tDebugger = Date.now() - t0;
      }
      const cdp = await connect(wsUrl);
      if (tAppPage === null && (await onAppPage(cdp))) {
        tAppPage = Date.now() - t0;
      }
      const rows = await cdp.call("Runtime.evaluate", {
        expression: `location.href.includes("tauri.localhost") && document.querySelectorAll("[data-commit-row]").length`,
        returnByValue: true,
      });
      await cdp.close();
      if (typeof rows === "number" && rows > 0) {
        bootMs = Date.now() - t0;
        break;
      }
    } catch { /* the page target churns while the webview boots; retry */ }
    await sleep(150);
  }
  await sleep(10000); // settle: OS caches, paint, GC

  const ram = idleRamMB();
  const cdp = await connect(wsUrl);
  const rows = await cdp.call("Runtime.evaluate", {
    expression: `document.querySelectorAll("[data-commit-row]").length`,
    returnByValue: true,
  });
  const tabs = await cdp.call("Runtime.evaluate", {
    expression: `document.querySelectorAll("[data-tab-id]").length`,
    returnByValue: true,
  });
  await cdp.close();

  child.kill();
  killApp();
  console.log(JSON.stringify({ bootMs, tDebugger, tAppPage, rows, tabs, idleRamMB: +ram.toFixed(1) }));
  return { bootMs, idleRamMB: ram, rows, tabs };
}

const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

(async () => {
  await seed([repos[0]]);
  const runs1 = [];
  for (let i = 0; i < 3; i++) runs1.push(await oneRun());

  await seed(repos.slice(0, 5));
  const runs5 = [];
  for (let i = 0; i < 2; i++) runs5.push(await oneRun());

  const boot1 = median(runs1.map((r) => r.bootMs));
  const boot5 = median(runs5.map((r) => r.bootMs));
  const ram1 = median(runs1.map((r) => r.idleRamMB));
  const ram5 = median(runs5.map((r) => r.idleRamMB));

  console.log("\n== digest ==");
  console.log(`cold start (1 repo):  ${boot1} ms`);
  console.log(`cold start (5 repos): ${boot5} ms`);
  console.log(`idle RAM (1 tab):     ${ram1.toFixed(0)} MB`);
  console.log(`idle RAM (5 tabs):    ${ram5.toFixed(0)} MB`);
  console.log(`cost per extra tab:   ~${((ram5 - ram1) / 4).toFixed(0)} MB`);
})();
