# Git Mapper

A lightweight, standalone Git history viewer for Windows, built with Tauri 2, React 19,
TypeScript, Tailwind CSS v4 and a clean glassmorphism design system. This repository currently
contains the **application shell and visual UI only**: the history, refs, changed files and diffs
are mock data, and no Git commands are executed.

## What the UI does

- Title bar carrying the brand, the open repositories as tabs (each remembering its own selected
  commit and file, drag one sideways to reorder, and the order survives a restart), the current
  branch with ahead/behind counts, settings and the window buttons.
- The details panel opens when a commit is clicked and closes from its own button.
- SVG commit graph with coloured lanes, aligned row by row with the commit list.
- Draggable dividers for the graph gutter, the commit / author / date columns, the details sidebar
  and the height of the details panel. Arrow keys nudge a focused divider, double-click resets it.
- Commit rows with branch, remote and tag labels inline after the subject.
- Details panel with commit metadata, the changed-file list and a line-numbered diff.
- Light and dark glass themes, switched from the settings dialog and remembered on the device. With
  no stored choice the app follows the operating system preference.
- The panel closes from its own `×` button or the toolbar toggle, leaving the list and graph at full
  height; it reopens at the height you left it, or immediately when you click a commit row.

## Not implemented yet

- Reading real repositories, commit history or working tree state.
- Graph lane layout (lane numbers are authored in the mock data).
- Commit, checkout, merge, rebase or any other mutating Git operation.
- Opening or closing repositories from the UI; the mock has two fixed tabs.

## Run it

```bash
npm install
npm run dev        # browser at http://localhost:1420
npm run tauri dev  # desktop window (compiles the Rust side)
```

Production build and type check:

```bash
npm run build      # tsc && vite build
npm run tauri build
```

## Layout of the source

```
src/
  types.ts                  typed data model (Commit, ChangedFile, Repository, ...)
  data/                     mock repositories, commits, refs, files and diffs
  lib/graphGeometry.ts      row/lane geometry and commit -> parent edge paths
  lib/format.ts             date, status and diff line-number helpers
  lib/tableLayout.ts        grid templates and min/max sizes for the resizable panels
  lib/theme.ts              light/dark theme resolution, application and storage
  components/               TitleBar, CommitList, CommitGraph, CommitRow, RefPill, ResizeHandle,
                            SettingsModal, DetailsPanel, FileList, DiffViewer, EmptyState, icons
  App.tsx                   shell layout, per-repository selection, details panel state
  index.css                 Tailwind entry, theme tokens and global base styles
```

Styling is utility-first Tailwind over a small set of semantic tokens declared in `src/index.css`:

| Token group | Values |
| --- | --- |
| Brand | `primary #6E56CF` (dusty violet), `primary-ink #563D9A`, `secondary #57536E` |
| Status | `success #30A46C`, `warning #E0A24B`, `danger #D5535E`, `info #477FB8` |
| Text | `ink #17151F`, `ink-soft #413D51`, `ink-dim #544F68`, `rule` (8% ink) |
| Glass | `glass` (white 76%), `glass-strong` (88%), `glass-soft` (55%), `hairline` (white 78%), `sheet`, `scrim` |
| Lanes | `lane-1..6`: violet, steel, rose, teal, amber, slate — muted, distinct against glass |
| Type | Plus Jakarta Sans (UI), JetBrains Mono (hashes, diffs) - self-hosted in `public/fonts` |

Dark mode re-points the same tokens in the `.dark` block (canvas `#070B12`, smoked glass, light
ink, brighter lanes), so every component follows without `dark:` variants. The choice is stored in
`localStorage` under `git-mapper:theme` and applied by an inline head script before first paint to
avoid a flash of the wrong theme.

Panels are translucent cards with a 1px luminous border and a 24px backdrop blur (`PANEL` in
`src/lib/ui.ts`), floating over fixed colour fields in `body::before` — a full-canvas
violet→rose→warm linear gradient plus radial accents in light, radial glows on near-black in dark.
Depth comes from the vivid background, not heavy shadows. Because Tailwind v4 inlines `@theme`
values into its generated utilities, `--shadow-panel`/`--shadow-soft` reach the DOM through the
custom `panel-shadow`/`soft-shadow` utilities (declared with `@utility`, routing through the CSS
variable) — use those instead of `shadow-*` so `.dark` overrides keep working. Add new colours as
`@theme` tokens rather than hardcoding hex values in components. Commit rows are 44px
(`ROW_HEIGHT` in `src/lib/graphGeometry.ts` is shared with the SVG graph; both must move together).

Accessibility: every text token clears WCAG 2.2 AA; commit subjects measure 10.3:1 (light) and
16.7:1 (dark). Interactive rows, tabs and resizers are
keyboard focusable with 2px `primary` focus rings; the settings dialog traps Tab, closes on Escape
and returns focus to its trigger; resize dividers expose `role="separator"` and arrow keys.

To swap in real data later, replace `src/data/repositories.ts` with a loader that returns the same
`Repository[]` shape.

## Recommended IDE setup

[VS Code](https://code.visualstudio.com/) with the
[Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) and
[rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
extensions.
