# AGENTS.md — Git Mapper

Guidance for AI agents working in this repo. Written after the full redesign + rename; treat it as the current state of the project, not history.

## Project

**Git Mapper** (formerly Git Trail) — standalone Git history viewer for Windows. Tauri 2 + React 19 + TypeScript + Tailwind CSS v4 + Vite. **UI shell with mock data only**: history, refs, files and diffs are hardcoded mocks; no Git operations exist yet.

- Project folder is still `C:\DATA\lab\tauri\git-trail` (user renames it later. When that happens, update `path` in `src/data/gitMapperRepo.ts:11`).
- Package/crate/identifier/brand are already `git-mapper` / `git_mapper_lib` / `com.fajar.git-mapper` / "Git Mapper".

## Commands

```bash
npm run build        # gate for frontend work: tsc && vite build (run this before claiming done)
npm run dev          # vite dev server on http://localhost:1420
npm run tauri dev    # desktop window
cargo check          # in src-tauri/; gate for Rust work
```

No tests, no linter configured. `npm run build` + `cargo check` pass = verifiable state.

## Architecture

- `src/App.tsx` — shell: grid rows `[52px toolbar | 40px repo tabs | 1fr workspace | 26px status bar]`, per-repo selection state, details-panel open/height state.
- `src/data/` — `repositories.ts` exports the two mock repos (`gitMapperRepo`, `ledgerApiRepo`); everything is typed in `types.ts`.
- `src/lib/graphGeometry.ts` — `ROW_HEIGHT = 44` is shared between `CommitRow` (h-11) and the SVG graph. Change both together or dots misalign with rows.
- `src/lib/ui.ts` — `PANEL` and `GLASS_CONTROL` class strings; every panel/button picks these up.
- `src/lib/tableLayout.ts` — column widths, grid templates, resize min/max.
- `src/lib/theme.ts` + inline script in `index.html` — theme resolution; storage key `git-mapper:theme`; the head script must stay in sync with that key.
- `src/index.css` — all design tokens (`@theme` block + `.dark` overrides) and the background aurora (`body::before`).

## Design-system rules (project conventions)

1. **Tokens only.** No hardcoded hex in components (exception: inline SVG strokes in the Toolbar `BrandMark`). Re-point tokens in `.dark`; components follow without `dark:`-variant spans.
2. **Use `panel-shadow` / `soft-shadow`** (custom `@utility` in index.css), never Tailwind's `shadow-panel`/`shadow-soft`. Reason: Tailwind v4 inlines `@theme` literals into generated utilities, so `.dark` overrides of shadow vars silently never applied. The custom utilities route through `var()` and theme correctly.
3. Rows are 44px, body text 14px, commit subjects 13.5px, meta 12.5px. Full type/spacing scale lives in `index.css` + component classes; keep hierarchy bouncy (big accents, airy spacing) — density is what made the previous design look dated.
4. Background depth strategy: vivid full-canvas gradient (light theme gets a linear violet→rose→warm base because radial spots alone measured sat 0.07 and washed out) + subtle shadows. Don't add heavy drop shadows.
5. Pills/badges: no borders, saturated tone fills (`bg-primary/12` etc.). Glass panels: `border-hairline` + `panel-shadow` + `backdrop-blur-xl` via `PANEL`.

## Known pitfalls

- **design references:** target look is a frosted-glass commit feed (Dribbble-style, violet/rose/warm palette). The user judges ugliness by: row density, font-scale hierarchy, background saturation. "Ours should be close to the reference" means those three.
- **headless verification:** headless Chrome inherits the system `prefers-color-scheme` (dark on this machine). To screenshot the light theme, pre-seed `localStorage.setItem("git-mapper:theme","light")` before the app loads (server the built `dist/` over http — absolute `/assets/` paths break under `file://`).
- `vision_analyze` on this setup 401s (upstream credential). Verify visuals with pixel probes (PIL/numpy) or live computed styles instead of screenshots.
- Dist builds are hashed (`index-*.js/css`); stale copies in preview dirs cause "old design" confusion — always re-copy `dist/*` before capturing.

## Roadmap (not built yet)

Real `git` plumbing (history, refs, working tree), graph lane layout algorithm, mutating Git operations, open/close repository UI. Swap `src/data/repositories.ts` for a loader returning the same `Repository[]` shape when real data lands.
