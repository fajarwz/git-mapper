# Known pitfalls

- **A new `#[tauri::command]` must be listed in `generate_handler!` (`src-tauri/src/lib.rs`).**
  Nothing else notices when it is missing: `cargo test` calls the `*_in` bodies directly, the dev
  middleware serves the browser fallback, and the dead-code warnings it raises read like noise
  from the lib crate. Only the desktop window fails, with "command not found" on every call.
- **Slow repos are the WSL mount, not the row count.** Opening a repo on `\\wsl.localhost`
  (jersium: 12.8k commits, 585 branches) measured 2.5s for the 500-row log, 0.6s refs, but ~21s
  for `git status --porcelain` (9P stat'ing every tracked file) — the worktree digest pays that
  on every open and focus probe. TS-side parse + lane layout of 500 rows is ~7ms and the DOM
  render is fine, so shrinking the first page (500) or adding virtualization does nothing for
  it; the async commands above are what keep the window alive while git grinds. A repo opened
  from inside WSL (`git` in the distro on ext4) is the real speedup if status stays painful.
- **Never reload the webview.** WebView2's context-menu Reload (and F5 / Ctrl+R) reloads the
  custom-protocol origin and lands on Edge's "can't reach this page" instead of the app.
  `src/shared/lib/webview.ts` blocks both paths at startup; dev keeps the context menu for Inspect,
  Ctrl+Shift+I still opens devtools. Refresh data by focusing the window (see App.tsx) or by
  reopening the tab, not by reloading the page.
- **The app icon regenerates from `src-tauri/icons/app-icon.svg`** (brand glyph on the violet
  tile — keep it in sync with TitleBar's BrandMark): `npx tauri icon src-tauri/icons/app-icon.svg`
  rewrites every format. `tauri dev` does NOT rebuild on an icon change — the exe keeps the old
  embedded `icon.ico` — so `touch src-tauri/build.rs` and restart the app to see it.

- **Tests must not assume the dev machine.** CI is the ubuntu runner: `git init` there still
  defaults to `master` while every `git.rs` fixture asserts `main`, and there is no global
  `user.name`, so a commit in a freshly cloned fixture dies with "Author identity unknown".
  Fixtures init with `-b main` and reapply the identity after a `git clone`; a date assertion
  passes an explicit IANA zone instead of trusting the runner's clock zone. Reproduce both
  conditions locally by pointing `GIT_CONFIG_GLOBAL` at a config with
  `[init] defaultBranch = master` and no identity — `cargo test` under it is the honest rehearsal.
- **verifying without the desktop window:** `npm run dev` exposes the same git commands as
  `POST /api/git` (`{op, args}`), so a headless Chrome probe of `http://127.0.0.1:1420` exercises the
  real TS path (refresh, wip payloads, flash classes) without rebuilding Rust. Rust-side changes
  still need the app restarted — Vite HMR only covers the frontend.
- **headless verification:** headless Chrome inherits the system `prefers-color-scheme` (dark on this machine). To screenshot the light theme, pre-seed `localStorage.setItem("git-mapper:theme","light")` before the app loads (server the built `dist/` over http — absolute `/assets/` paths break under `file://`).
- `vision_analyze` on this setup 401s (upstream credential). Verify visuals with pixel probes (PIL/numpy) or live computed styles instead of screenshots.
- Dist builds are hashed (`index-*.js/css`); stale copies in preview dirs cause "old design" confusion — always re-copy `dist/*` before capturing.
