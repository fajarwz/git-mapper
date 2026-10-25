# AGENTS.md — Git Mapper

Guidance for AI agents working in this repo. Written after the full redesign + rename; treat it as the current state of the project, not history.

## Project

**Git Mapper** (formerly Git Trail) — standalone Git history viewer for Windows. Tauri 2 + React 19 + TypeScript + Tailwind CSS v4 + Vite. Reads real Git data: the Tauri backend runs the `git` CLI and returns porcelain output; TS parsers turn it into `types.ts` shapes. Read-only apart from a branch checkout (`checkout_branch`, from double-clicking a branch
pill); there is no staging or committing.

- Package/crate/identifier/brand are `git-mapper` / `git_mapper_lib` / `com.fajar.git-mapper` / "Git Mapper".

## Commands

```bash
npm run build        # gate for frontend work: tsc && vite build (run this before claiming done)
npm run lint         # tailwind hygiene autofix over src (eslint-plugin-tailwindcss); run after CSS-class changes
npm run lint:check   # same rules without fixing (CI-style check)
npm test             # vitest: graph regression, parsers, gitLoader (mocked invoke), components, App
npm run dev          # vite dev server on http://localhost:1420
npm run tauri dev    # desktop window
cargo check          # in src-tauri/; gate for Rust work
cargo test           # in src-tauri/; git.rs against real throwaway repos (runs git CLI)
```

`npm test` is Vitest; unit and component tests sit next to their source (`src/**/<file>.test.ts(x)`), the App integration slice lives in `tests/`. Component and App tests need jsdom
(`// @vitest-environment jsdom` on the file) and stub `window.__TAURI_INTERNALS__` +
`ResizeObserver`; `@tauri-apps/api/core` is mocked with `vi.mock(..., () => ({ invoke: vi.fn() }))`.
`cargo test` builds throwaway git repos under the OS temp dir — keep them self-contained
(no remote network, cheap fixtures). `npm run lint` is a Tailwind class checker, not a code
linter. `npm run build` + `npm test` + `npm run lint:check` + `cargo test` pass = verifiable state.

## Architecture

- `src/App.tsx` — shell: `TitleBar` row (40px) over a flex-1 content area holding the commit list + details panel, per-repo selection state, details-panel open/height state. `Repository[]` lives in state (open tabs persisted to `localStorage` under `git-mapper:open-repos`, written only after the first load lands); empty state = `EmptyState.tsx`.
- `src/components/TitleBar.tsx` — the window IS undecorated (`decorations: false` in `tauri.conf.json`), so this bar doubles as the title bar: brand, repo tabs (Chrome-style shrink + `tab-fade` on clipped labels), toolbar actions (a search box that filters the active repo's loaded commits — Ctrl+F focuses it, Esc clears — plus a refresh button whose glyph spins for at least 550ms so a fast local read still reads as work, and settings) and the caption buttons. Tabs reorder through `@dnd-kit/sortable` (`horizontalListSortingStrategy` + `DragOverlay`); the sensors are **pointer only**, because the keyboard sensor claims Space/Enter on the focused tab and a tab must stay activatable from the keyboard. HTML5 drag-and-drop is not an option here: the webview routes drag events to Tauri's file-drop handler. `data-tauri-drag-region` covers the bar background and the tab strip; the caption buttons need the `core:window:allow-*` entries in `src-tauri/capabilities/default.json`.
- `src-tauri/src/git.rs` — Tauri commands running the `git` CLI: `open_repository` (validates + toplevel/name), `read_status` (branch / ahead / behind / head + the worktree digest), `read_refs` (`hash	fullref` lines), `read_log` (porcelain fields `\x00`-separated, records `\x1e`-separated, decorations lead each record), `read_log_delta` (`git log --all ^<head>`), `read_log_order` (hashes only, for splicing),
  `read_commit_files` (numstat + name-status + patch, first-parent; root via `--root`; the
  pseudo hash `wip` means the working tree), `checkout_branch`. Folder picking is JS-side via `tauri-plugin-dialog` (`dialog:default` capability).
- `src/data/gitLoader.ts` — the only `invoke()` surface: `loadRepository`, `pickAndLoadRepository`,
  `refreshRepository`, `loadCommitFiles`, plus persisted-path storage. Build the `Repository`/`Commit`
  objects there; components stay invoke-free.
- **Refresh is surgical.** `refreshRepository` runs two cheap reads (`read_status`, `read_refs`) and
  compares branch + HEAD + dirty size + the **worktree digest** + a digest of every ref.
  Unchanged → `null`, no state update. The digest is why the uncommitted row updates at all: the
  dirty *count* stays put while a file is edited, so `read_status` also hashes the status list,
  the tracked `git diff HEAD` and the size/mtime of every untracked file.
  A moved HEAD *or* a moved ref triggers `read_log_delta` (`git log --all ^<oldHead>`): a fetch that
  only adds a branch leaves HEAD alone but its commits are still new to the window. The delta is
  spliced in **git's own order** (`read_log_order`, `git log --all --format=%H`), because a branch
  pushed late can carry commits older than rows already on screen. Empty delta with a moved HEAD, or
  a full page, means history was rewritten or the window shifted → `loadRepository`. Unchanged
  commits keep object identity (`withLanes`, `sameRefs`) so the memoized `CommitRow` skips their
  render, and the return value lists the rows a caller should flash (`touched`) — the
  uncommitted row included, since it is rebuilt from scratch instead of coming out of the delta.
  `refreshRepository(repo, force)` only drops the early exit: that is the toolbar refresh
  button, and it is what makes the uncommitted row refetch through its new digest key.
- **The uncommitted row owns its file list.** `git diff HEAD` never lists untracked paths, so
  `read_commit_files(dir, "wip")` appends numstat/name-status/patch entries for every
  `git ls-files --others --exclude-standard` path (binary → a "not shown" hunk). The dev
  middleware in `vite.config.ts` mirrors this and the worktree digest — keep the two in sync.
- `src/lib/` parsers — `gitLogParser`, `gitDiffParser` (DiffLine text carries NO +/- prefix; the renderer adds it), `graphLanes` (git-shaped layout: dense lanes, tips append on the right, merge parents fork just right of the commit, closed lanes shift the rest left, and a commit reserved by several children keeps the leftmost and joins the rest — `MAX_LANES` is a hard width cap). All pure, no React — verifiable with `npx vite-node <probe>` against real git output.
- Changed files/diffs load lazily per selected commit (`App` keeps `filesByCommitHash`); the commit list never carries them.
- Window focus re-checks the visible repo only (throttled to one probe per 1.5s, hidden windows skipped). Other tabs are not refreshed — they are off screen and each refresh costs git reads.
- `src/lib/graphGeometry.ts` — `ROW_HEIGHT` is shared between `CommitRow` and the SVG graph. Change both together or dots misalign with rows.
- `src/lib/commitFilter.ts` — `filterCommits(commits, query)`: space-separated tokens AND together, case-insensitive substring over hash, subject, body, author, email and ref-pill names (literal text — no fuzzy `_`/`-` folding). An empty query returns the input array itself so rows keep object identity. Search covers ONLY the loaded window; paging is suspended while a query is active, and deep search over unpaginated history is a planned separate slice.
- `src/components/ContextMenu.tsx` — the right-click menu on commit rows and ref pills. Entries: `Check out <branch>` (only for a local branch that is not current), `Copy commit hash` / `Copy branch|remote|tag|stash name` / `Copy commit message`; a copy flips that entry to "Copied!" for 700ms, then the menu closes. Dismisses on outside pointerdown, Escape, scroll (capture) and resize. Clipboard goes through `src/lib/clipboard.ts` `copyText`, which falls back to a hidden textarea because WebView2 can deny the async clipboard API per-origin.
- `src/lib/ui.ts` — `PANEL` and `GLASS_CONTROL` class strings; every panel/button picks these up.
- `src/lib/tableLayout.ts` — column widths, grid templates, resize min/max.
- `src/lib/persisted.ts` — `usePersistedState` (localStorage-backed `useState`) and the `STORAGE_KEYS`
  registry every key goes through. Launch restores: open repo paths, the active tab, the selected
  commit and file per repo, and the details panel open/height. Window bounds come from
  `tauri-plugin-window-state` (Rust side, `window-state:default` capability), not from localStorage.
- `src/lib/theme.ts` + inline script in `index.html` — theme resolution; storage key `git-mapper:theme`; the head script must stay in sync with that key.
- `src/index.css` — all design tokens (`@theme` block + `.dark` overrides) and the background aurora (`body::before`).

## Design-system rules (project conventions)

1. **Tokens only.** No hardcoded hex in components; icon markup lives in `src/assets/*.svg` (loaded via svgr `?react` imports through `icons.tsx`) with strokes in `currentColor`. Re-point tokens in `.dark`; components follow without `dark:`-variant spans.
2. **Use `panel-shadow` / `soft-shadow`** (custom `@utility` in index.css), never Tailwind's `shadow-panel`/`shadow-soft`. Reason: Tailwind v4 inlines `@theme` literals into generated utilities, so `.dark` overrides of shadow vars silently never applied. The custom utilities route through `var()` and theme correctly.
3. Row heights and type sizes live in code (`graphGeometry.ts`, component classes) — don't pin them here; they get tuned. Full type/spacing scale lives in `index.css` + component classes; keep hierarchy bouncy (big accents, airy spacing) — density is what made the previous design look dated.
4. Background depth strategy: vivid full-canvas gradient (light theme gets a linear violet→rose→warm base because radial spots alone measured sat 0.07 and washed out) + subtle shadows. Don't add heavy drop shadows.
5. Pills: the checked-out branch is a filled `laneColor` pill with `text-surface`; every other ref
   is an outline pill with a 1.5px lane-coloured border and lane-tinted text. Spell the width
   `border-[1.5px]` - `border-1.5` is not a utility and silently renders 0px. Glass panels: `border-hairline` + `panel-shadow` + `backdrop-blur-xl` via `PANEL`.

5. **Chrome on the canvas needs a backing.** The title bar sits straight on the aurora, so bare text
   there measures ~2.8:1 (`text-ink-soft` over the gradient). Anything interactive or readable in the
   bar gets `bg-glass-soft` + `backdrop-blur-md`; contrast after: brand 9.9, tabs 6.1, add button 7.0.
   `BrandMark` is the one solid control: `bg-primary` with a white glyph, so it reads in both themes.

## Known pitfalls

- **Never reload the webview.** WebView2's context-menu Reload (and F5 / Ctrl+R) reloads the
  custom-protocol origin and lands on Edge's "can't reach this page" instead of the app.
  `src/lib/webview.ts` blocks both paths at startup; dev keeps the context menu for Inspect,
  Ctrl+Shift+I still opens devtools. Refresh data by focusing the window (see App.tsx) or by
  reopening the tab, not by reloading the page.

- **design references:** target look is a frosted-glass commit feed (Dribbble-style, violet/rose/warm palette). The user judges ugliness by: row density, font-scale hierarchy, background saturation. "Ours should be close to the reference" means those three.
- **Graph geometry:** lines are drawn row to row, never across rows. `layoutGraph` returns, per row,
  the lanes above and below the commit plus whether the row is a tip, so `buildEdges` can draw every
  fork, join and lane shift as a bend inside that row's band, merge vertical pieces into one path
  per lane and colour, and leave tips without a line above them. Drawing a child-to-parent curve
  instead is what produced long diagonals that read as nodes jumping across the graph.
  **Colour belongs to the lane.** Lane *k* is always `laneColor(k)`, and every piece is drawn in
  the colour of the lane it ends in, so a line that moves takes the new lane's hue at the bend and
  neighbouring lanes never share one. The dot, its segments and its ref pills all use
  `laneColor(commit.lane)`, so a row and its node always match. Do not carry a colour in the line:
  a shifting line keeping its old hue is what made the graph read as broken.
  **A joining merge leaves its column empty.** When a commit joins an existing line, its own
  column is filled with `null` instead of collapsing, and the lines to its right stay put.
  Collapsing there pulled the merge's second parent into the dot's column, so the branch was
  drawn straight down in the dot's hue and looked like it never separated. The hole is reclaimed
  by the next branch tip that needs a lane. A plain (non-merge) join still collapses, as git does.
  **One line per pending commit.** A parent reserved by several children is drawn ONCE; each extra
  child records `join` and bends into that line at its own row. Reserving a lane per child drew the
  same commit as several parallel lines that fanned into one dot rows later (that was the
  `jersium-marketplace` breakage). `laneX` is not clamped: lanes past the palette still get their
  own x, and the graph width comes from `layout.laneCount`. The gutter column follows that width
  in fit mode, but a splitter drag pins an ABSOLUTE width (never an offset from the natural
  width — re-laid lanes, e.g. a search filter, would turn a stored offset negative, zero the
  column out, vanish the graph and slam the header left). A pinned column clips overflowing
  lanes on the right (`overflow-hidden`).
  **The layout records the pieces.** `layoutGraph` returns, per row, `transitions` (kind
  `continue` / `shift` / `fork` / `join`, source lane, destination lane, colour, target hash) and
  `gaps` (a parent outside the loaded window, or one already drawn because the input was not
  ordered). `buildEdges` only turns those into coordinates: it never matches hashes or guesses a
  connection. Add a test before teaching the layout a new transition kind.
- **The log is read in `--date-order`.** That promise (no parent before all of its children) is
  what the single-sweep lane allocation relies on. Plain date order can place a parent above its
  child after a clock skew; `--topo-order` is valid but groups each branch, leaving every other
  branch tip's lane open at once (406 lanes on a 400-branch repo against 11 with `--date-order`).
  `layoutGraph` reports `ordered: false` and drops such connections instead of drawing upward, with
  `gaps` saying why.
- **Stashes are their own rows, not history.** Only `refs/stash` is a ref and it points at the
  newest entry, so `for-each-ref` and `log --all` can never see the older ones: `read_stashes`
  reads the reflog (`git stash list`), and every log read passes `--exclude=refs/stash` so the
  stash commit and its `index on …` snapshot stop masquerading as commits. `stashRows` builds one
  row per entry with a `stash@{n}` pill and `stashIndex` set, from the stash commit's FIRST parent
  only (the commit it was taken on) — its other parents are plumbing. Those rows are NOT pinned
  above history: `mergeStashes` files each one by the date the stash was taken (only the
  uncommitted row is pinned on top), which keeps the list in `--date-order` so the stash's base
  commit stays below its row and the lane layout holds. They are rebuilt on every refresh
  (`stashDigest` notices a take or a drop, and a drop renumbers the survivors so the moved pill
  flashes), and are excluded from the log-order splice and the paging count. The details panel
  diffs a stash against `^1`; a `stash -u` entry also needs its third parent, a parentless commit
  holding only the untracked files (`git show <hash>^3`), which `read_commit_files` appends.
- **verifying without the desktop window:** `npm run dev` exposes the same git commands as
  `POST /api/git` (`{op, args}`), so a headless Chrome probe of `http://127.0.0.1:1420` exercises the
  real TS path (refresh, wip payloads, flash classes) without rebuilding Rust. Rust-side changes
  still need the app restarted — Vite HMR only covers the frontend.
- **headless verification:** headless Chrome inherits the system `prefers-color-scheme` (dark on this machine). To screenshot the light theme, pre-seed `localStorage.setItem("git-mapper:theme","light")` before the app loads (server the built `dist/` over http — absolute `/assets/` paths break under `file://`).
- `vision_analyze` on this setup 401s (upstream credential). Verify visuals with pixel probes (PIL/numpy) or live computed styles instead of screenshots.
- Dist builds are hashed (`index-*.js/css`); stale copies in preview dirs cause "old design" confusion — always re-copy `dist/*` before capturing.

## Roadmap (not built yet)

Deep search over unpaginated history (loaded-window filtering is built: the title-bar search box), staging / committing / merging, a side-by-side diff view.
History pages at 500 commits per read; `loadMoreCommits` appends the next page on scroll.
