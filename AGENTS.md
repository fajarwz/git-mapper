# AGENTS.md — Git Mapper

Guidance for AI agents working in this repo. Written after the full redesign + rename; treat it as the current state of the project, not history.

## Project

**Git Mapper** (formerly Git Trail) — standalone Git history viewer for Windows. Tauri 2 + React 19 + TypeScript + Tailwind CSS v4 + Vite. Reads real Git data: the Tauri backend runs the `git` CLI and returns porcelain output; TS parsers turn it into `types.ts` shapes. Read-only (no mutating Git operations yet).

- Package/crate/identifier/brand are `git-mapper` / `git_mapper_lib` / `com.fajar.git-mapper` / "Git Mapper".

## Commands

```bash
npm run build        # gate for frontend work: tsc && vite build (run this before claiming done)
npm run dev          # vite dev server on http://localhost:1420
npm run tauri dev    # desktop window
cargo check          # in src-tauri/; gate for Rust work
```

No tests, no linter configured. `npm run build` + `cargo check` pass = verifiable state.

## Architecture

- `src/App.tsx` — shell: `TitleBar` row (40px) over a flex-1 content area holding the commit list + details panel, per-repo selection state, details-panel open/height state. `Repository[]` lives in state (open tabs persisted to `localStorage` under `git-mapper:open-repos`, written only after the first load lands); empty state = `EmptyState.tsx`.
- `src/components/TitleBar.tsx` — the window IS undecorated (`decorations: false` in `tauri.conf.json`), so this bar doubles as the title bar: brand, repo tabs (Chrome-style shrink + `tab-fade` on clipped labels), toolbar actions and the caption buttons. `data-tauri-drag-region` covers the bar background and the tab strip; the caption buttons need the `core:window:allow-*` entries in `src-tauri/capabilities/default.json`.
- `src-tauri/src/git.rs` — Tauri commands running the `git` CLI: `open_repository` (validates + toplevel/name), `read_status` (branch/ahead/behind), `read_log` (porcelain fields `\x00`-separated, records `\x1e`-separated, decorations lead each record), `read_commit_files` (numstat + name-status + patch, first-parent; root via `--root`). Folder picking is JS-side via `tauri-plugin-dialog` (`dialog:default` capability).
- `src/data/gitLoader.ts` — the only `invoke()` surface: `loadRepository`, `pickAndLoadRepository`,
  `refreshRepository`, `loadCommitFiles`, plus persisted-path storage. Build the `Repository`/`Commit`
  objects there; components stay invoke-free.
- **Refresh is surgical.** `refreshRepository` runs two cheap reads (`read_status`, `read_refs`) and
  compares branch + HEAD + dirty size + a digest of every ref. Unchanged → `null`, no state update.
  A moved HEAD *or* a moved ref triggers `read_log_delta` (`git log --all ^<oldHead>`): a fetch that
  only adds a branch leaves HEAD alone but its commits are still new to the window. The delta is
  spliced in **git's own order** (`read_log_order`, `git log --all --format=%H`), because a branch
  pushed late can carry commits older than rows already on screen. Empty delta with a moved HEAD, or
  a full page, means history was rewritten or the window shifted → `loadRepository`. Unchanged
  commits keep object identity (`withLanes`, `sameRefs`) so the memoized `CommitRow` skips their
  render, and the return value lists the rows a caller should flash (`touched`).
- `src/lib/` parsers — `gitLogParser`, `gitDiffParser` (DiffLine text carries NO +/- prefix; the renderer adds it), `graphLanes` (greedy lane assignment: a commit takes the lane a child reserved for it, every reservation of a commit is cleared when it is drawn, and lanes past `MAX_LANES` recycle round-robin — a real layout engine is still future work). All pure, no React — verifiable with `npx vite-node <probe>` against real git output.
- Changed files/diffs load lazily per selected commit (`App` keeps `filesByCommitHash`); the commit list never carries them.
- Window focus re-checks the visible repo only (throttled to one probe per 1.5s, hidden windows skipped). Other tabs are not refreshed — they are off screen and each refresh costs git reads.
- `src/lib/graphGeometry.ts` — `ROW_HEIGHT` is shared between `CommitRow` and the SVG graph. Change both together or dots misalign with rows.
- `src/lib/ui.ts` — `PANEL` and `GLASS_CONTROL` class strings; every panel/button picks these up.
- `src/lib/tableLayout.ts` — column widths, grid templates, resize min/max.
- `src/lib/persisted.ts` — `usePersistedState` (localStorage-backed `useState`) and the `STORAGE_KEYS`
  registry every key goes through. Launch restores: open repo paths, the active tab, the selected
  commit and file per repo, and the details panel open/height. Window bounds come from
  `tauri-plugin-window-state` (Rust side, `window-state:default` capability), not from localStorage.
- `src/lib/theme.ts` + inline script in `index.html` — theme resolution; storage key `git-mapper:theme`; the head script must stay in sync with that key.
- `src/index.css` — all design tokens (`@theme` block + `.dark` overrides) and the background aurora (`body::before`).

## Design-system rules (project conventions)

1. **Tokens only.** No hardcoded hex in components (exception: inline SVG strokes in the TitleBar `BrandMark`). Re-point tokens in `.dark`; components follow without `dark:`-variant spans.
2. **Use `panel-shadow` / `soft-shadow`** (custom `@utility` in index.css), never Tailwind's `shadow-panel`/`shadow-soft`. Reason: Tailwind v4 inlines `@theme` literals into generated utilities, so `.dark` overrides of shadow vars silently never applied. The custom utilities route through `var()` and theme correctly.
3. Row heights and type sizes live in code (`graphGeometry.ts`, component classes) — don't pin them here; they get tuned. Full type/spacing scale lives in `index.css` + component classes; keep hierarchy bouncy (big accents, airy spacing) — density is what made the previous design look dated.
4. Background depth strategy: vivid full-canvas gradient (light theme gets a linear violet→rose→warm base because radial spots alone measured sat 0.07 and washed out) + subtle shadows. Don't add heavy drop shadows.
5. Pills/badges: no borders, saturated tone fills (`bg-primary/12` etc.). Glass panels: `border-hairline` + `panel-shadow` + `backdrop-blur-xl` via `PANEL`.

## Known pitfalls

- **Never reload the webview.** WebView2's context-menu Reload (and F5 / Ctrl+R) reloads the
  custom-protocol origin and lands on Edge's "can't reach this page" instead of the app.
  `src/lib/webview.ts` blocks both paths at startup; dev keeps the context menu for Inspect,
  Ctrl+Shift+I still opens devtools. Refresh data by focusing the window (see App.tsx) or by
  reopening the tab, not by reloading the page.

- **design references:** target look is a frosted-glass commit feed (Dribbble-style, violet/rose/warm palette). The user judges ugliness by: row density, font-scale hierarchy, background saturation. "Ours should be close to the reference" means those three.
- **Graph geometry:** `buildEdges` moves a branch sideways at most one lane per row (one lane per
  row of vertical space, then a straight run down the parent's lane). Never cram a multi-lane
  shift into a single row: that reads as a node jumping across the graph. Lane dots sit on
  `rowY(index)`, so any geometry change must keep `ROW_HEIGHT` shared with `CommitRow`.
- **headless verification:** headless Chrome inherits the system `prefers-color-scheme` (dark on this machine). To screenshot the light theme, pre-seed `localStorage.setItem("git-mapper:theme","light")` before the app loads (server the built `dist/` over http — absolute `/assets/` paths break under `file://`).
- `vision_analyze` on this setup 401s (upstream credential). Verify visuals with pixel probes (PIL/numpy) or live computed styles instead of screenshots.
- Dist builds are hashed (`index-*.js/css`); stale copies in preview dirs cause "old design" confusion — always re-copy `dist/*` before capturing.

## Roadmap (not built yet)

Proper graph lane layout engine, mutating Git operations (stage, commit, branch), search/filter over history, pagination for repos with >500 commits (`read_log` caps at 500).
