# Design-system rules

1. **Tokens only.** No hardcoded hex in components; icon markup lives in `src/assets/*.svg` (loaded via svgr `?react` imports through `icons.tsx`) with strokes in `currentColor`. Re-point tokens in `.dark`; components follow without `dark:`-variant spans. **Exception: theme previews mock a fixed theme**, so they use literal colours — a token like `ink` re-points with the app theme and made the light preview's bar invisible in dark mode.
2. **Use `panel-shadow` / `soft-shadow`** (custom `@utility` in index.css), never Tailwind's `shadow-panel`/`shadow-soft`. Reason: Tailwind v4 inlines `@theme` literals into generated utilities, so `.dark` overrides of shadow vars silently never applied. The custom utilities route through `var()` and theme correctly.
3. Row heights and type sizes live in code (`graphGeometry.ts`, component classes) — don't pin them here; they get tuned. Full type/spacing scale lives in `index.css` + component classes; keep hierarchy bouncy (big accents, airy spacing) — density is what made the previous design look dated.
4. Background depth strategy: white canvas with soft glowing corners (light theme: steel-blue / rose / teal / violet radial glows at the edges, blurred so no color sits under text; dark theme keeps the same geometry with white halos on the deep canvas) + subtle shadows. Don't add heavy drop shadows.
5. Pills: the checked-out branch is a filled `laneColor` pill with `text-surface`, and so is
   the detached-HEAD marker (`type: "head"`, label "HEAD (detached)" — it is where the working
   copy sits but is not a branch, so nothing offers to check it out); every other ref
   is an outline pill with a 1.5px lane-coloured border and lane-tinted text. Spell the width
   `border-[1.5px]` - `border-1.5` is not a utility and silently renders 0px. Glass panels: `border-hairline` + `panel-shadow` + `backdrop-blur-xl` via `PANEL`.

5. **Chrome on the canvas needs a backing.** The title bar sits straight on the aurora, so bare text
   there measures ~2.8:1 (`text-ink-soft` over the gradient). Anything interactive or readable in the
   bar gets `bg-glass-soft` + `backdrop-blur-md`; contrast after: brand 9.9, tabs 6.1, add button 7.0.
   `BrandMark` is the one solid control: `bg-primary` with a white glyph, so it reads in both themes.
6. **Comments are scarce.** A comment exists only for what the code cannot say — a git quirk, a
   non-obvious invariant, a why. One to two lines; trivial restatements are deleted, not written.
   When touching existing code, trim verbose comments instead of adding to them.
7. **No god files.** `App.tsx` stays a composition shell; state and effects for one domain live
   in a dedicated hook (`src/features/<feature>/hooks/use<Name>.ts` (or beside the components in a flat feature)), pure logic in `<feature>/lib/`, the backend surface
   in `src/data/`. Same rule for tests: they follow the module they exercise. A file beyond
   ~300 lines or mixing domains splits the next time work touches it — not "someday".

- **design references:** target look is a frosted-glass commit feed (Dribbble-style, violet/rose/warm palette). The user judges ugliness by: row density, font-scale hierarchy, background saturation. "Ours should be close to the reference" means those three.

- **Labelled action buttons use `shared/components/Button.tsx`** with a `ButtonVariant` (`Primary`, `Secondary`, `Danger`); layout extras (`h-7`, `w-full`, `shrink-0`) go in `className`. Toggle segments, icon buttons, the title-bar pills and text-only links (`Later`, `Discard all…`) stay bespoke.

- **On/off options are toggles, never checkboxes.** Use `shared/components/Toggle.tsx` (a `role="switch"` button with a required `label`); put its text beside it in a `<label>` row. Native `<input type="checkbox">` is not used for settings or dialog options. The line-pick gutter cells in the diff are ticks over a selection, not an option, and stay checkbox-role.
