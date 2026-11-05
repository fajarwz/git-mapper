---
name: Git Mapper
description: Frosted-glass Git history viewer for desktop — real repos read through smoked panes over an aurora canvas
colors:
  primary: "#6e56cf"
  primary-ink: "#563d9a"
  secondary: "#57536e"
  success: "#30a46c"
  success-ink: "#218358"
  warning: "#e0a24b"
  warning-ink: "#8a5a11"
  danger: "#d5535e"
  danger-ink: "#c23a55"
  surface: "#ffffff"
  canvas: "#ffffff"
  ink: "#17151f"
  ink-soft: "#413d51"
  ink-dim: "#544f68"
  rule: "rgb(23 21 31 / 0.08)"
  glass: "rgb(255 255 255 / 0.76)"
  glass-strong: "rgb(255 255 255 / 0.88)"
  glass-soft: "rgb(255 255 255 / 0.55)"
  hairline: "rgb(23 21 31 / 0.14)"
  sheet: "rgb(255 255 255 / 0.5)"
  sheet-strong: "rgb(255 255 255 / 0.85)"
  hover-glass: "rgb(110 86 207 / 0.07)"
  selected-glass: "rgb(110 86 207 / 0.16)"
  scrim: "rgb(255 255 255 / 0.55)"
  glow-1: "rgb(71 127 184 / 0.6)"
  glow-2: "rgb(207 106 146 / 0.5)"
  glow-3: "rgb(47 161 134 / 0.45)"
  glow-4: "rgb(110 86 207 / 0.6)"
  lane-1: "#6e56cf"
  lane-2: "#477fb8"
  lane-3: "#cf6a92"
  lane-4: "#2fa186"
  lane-5: "#dd9438"
  lane-6: "#cf5a52"
  lane-7: "#3f8f6f"
  lane-8: "#b06ab3"
typography:
  headline:
    fontFamily: "Plus Jakarta Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Plus Jakarta Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Plus Jakarta Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Plus Jakarta Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "0.656rem"
    fontWeight: 600
    lineHeight: 1
  mono:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, monospace"
    fontSize: "0.656rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  badge: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  full: "9999px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  panel:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    typography: "0.75rem / 600"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-glass:
    backgroundColor: "{colors.glass-strong}"
    textColor: "{colors.ink}"
    typography: "0.75rem / 600"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  field-glass:
    backgroundColor: "{colors.glass-soft}"
    textColor: "{colors.ink-soft}"
    typography: "0.75rem / 400"
    rounded: "{rounded.sm}"
    height: "28px"
  toggle-switch:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    height: "22px"
    width: "40px"
---

# Design System: Git Mapper

## Overview

**Creative North Star: "The Frosted Observatory"**

A Git history viewer that behaves like glass instruments over a lit-white glow field: the data sits on translucent smoked panes, and the colour behind them is what makes each pane visible. Depth comes from the background and from glass tinting, almost never from drop shadows. The system is calm and precise — hierarchy is drawn through a bouncy type ladder (big 16px titles, a 14px body, tiny 10.5px data labels) rather than through decoration, and every metric object (hashes, counts, diffs) speaks in a mono micro-voice.

Colour is disciplined: one muted violet accent (Dusty Iris #6e56cf, slightly greyed, never neon) carries all meaning, and a fixed family of eight muted lane hues owns the commit graph — where colour is not decoration but topology. Components only reference semantic tokens; re-pointing them under `.dark` themes the entire app without `dark:` variants in components.

**Background history (updated after the swap):** the original light canvas was a vivid violet→rose→warm aurora; the owner judged it "AI-generated" and it was replaced in November 2026 by a white canvas with soft glowing corners. The depth language — glass panes over a canvas that carries the colour — survived the swap; the saturated sunset field did not.

**Key Characteristics:**
- Glass layers everywhere (`PANEL`: hairline border + `bg-glass` + `panel-shadow` + `backdrop-blur-xl`), always legible edges via a bright hairline + inset highlight.
- Tokens-only theming: components reference `--color-*` variables; `.dark` re-points them.
- Lane-chromatic graph: a node, its line segments and its ref pills always share `laneColor(k)`.
- Micro-mono for data; bold titles carry the hierarchy.
- Desktop-only: "responsive" means user-resizable panes, not breakpoints.

## Colors

A muted violet world with dusty steel/rose/teal/amber satellites — saturated enough to feel alive behind glass, greyed enough to never shout. Light values below are canonical; every token has a `.dark` twin in `src/index.css` that must be re-pointed together.

### Primary
- **Dusty Iris** (`#6e56cf`): the one voice of the system. Filled invariants only: the checked-out branch pill, the primary button, selection tints (`hover-glass` / `selected-glass` at 7–12% alpha), focus rings, the BrandMark tile.
- **Iris Deep** (`#563d9a`, dark: `#b4a2f5`): the *ink* companion — keywords in syntax highlighting (function names themselves carry full primary) and readable text drawn from the primary on small surfaces.

### Secondary
- **Slate Plum** (`#57536e`, dark: `#b1abc9`): structural secondary text in chrome; in code it colours attribute names and markdown sections (it read as near-black on the diff's most visible tokens — function names — so they moved to primary).
### Tertiary
- **Success Green** (`#30a46c` / ink `#218358`): ahead counters, pushed-north arrows, strings in code.
- **Warning Amber** (`#e0a24b` / ink `#8a5a11`): sprite-dot tint on the settings gear, behind counters, and the only colour allowed to flash a row (`row-flash`).
- **Danger Rose** (`#d5535e` / ink `#c23a55`): red confirm dialogs and close buttons only — reserved, never decorative.
- **Graph lanes** (light `#477fb8 / #cf6a92 / #2fa186 / #dd9438 / #cf5a52 / #3f8f6f / #b06ab3`, all lifted one step in dark): lane identity for the commit graph. Gray never appears here — it is reserved for the uncommitted row alone: its dot and connector draw in a fixed `#8a8f9c` in both themes. Stash rows keep their branch hue on dot, pill and connector; only the dashed line marks them as snapshots.

### Neutral
- **Paper Surface / Canvas** (`#ffffff` light; dark surface `#0f1523`, canvas `#070b12`): solid backgrounds used sparingly (knobs, filled pill text colour) — most backgrounds are glass instead.
- **Ink** (`#17151f`, dark `#f3f4fc`) — primary text, on every surface.
- **Ink Soft** (`#413d51`, dark `#c5cbdd`) — secondary text, panel body copy.
- **Ink Dim** (`#544f68`, dark `#99a1b4`) — tertiary/metadata text, gutters, muted icons. The faintest text still fronting the glow canvas.
- **Rule** (`rgb(23 21 31 / 0.08)`, dark `rgb(255 255 255 / 0.1)`) — internal 1px separators.
- **Glass stack** — `glass .76 / glass-strong .88 / glass-soft .55 / sheet .5 / sheet-strong .85 / hairline .14 ink` (light; the hairline is neutral ink since the white canvas swap — white-on-white edges were invisible, so edges lean on ink): the panel/control hierarchy itself. In dark these become smoked `rgb(18 24 37 / …)` equivalents, hairline back to `rgb(255 255 255 / 0.15)`.
- **Scrim** (`rgb(255 255 255 / 0.55)` — a light frost, not a dark wash: the backdrop is a second frosted pane over the glow field, so modals dim by blurring out, never by muddying the canvas; the ink hairline + `panel-shadow` keep the fire visible on the white-on-white. Dark stays `rgb(0 0 0 / .55)`): behind modals, plus a `backdrop-blur-md` frost.
- **Glow field tokens** (`--color-glow-1..4`, dark re-points each to white at halved strength): the four corner glows behind the glass — steel blue top-right, rose bottom centre-left, teal top centre, Dusty Iris left mid. They live in `body::before` only; retuning the mood touches four lines per theme, never the positioned gradients. `hover-glass` stays at 7% on purpose: its white composite still reads (Δ≈19 on the red channel) as a whisper, which is what hover must be to keep `selected-glass` at 16% the clearly stronger state.

### Named Rules
**The Token Rule.** Components never hardcode hex; they reference `--color-*` tokens, and `.dark` does the theming. The two sanctioned exceptions are the syntax-scheme palettes (`github`, `neon` mock fixed themes) and the SettingsModal theme previews (also mocked).
**Dark-Chromatic Rule.** Colour belongs to the lane, not to the component: lane *k* is always `laneColor(k)`, and the node, every segment, and the ref pills of that commit all wear that hue. A line that shifts lanes takes the new hue at the bend.
**The Ink-Pair Rule.** Every loud colour carries a `*-ink` companion for readable small text; text on light backgrounds over loud colours must use the ink variant, giving white-on-purple and ink-pair-on-tint as the only pairings.

## Typography

**Display/Headline Font:** Plus Jakarta Sans (variable 200–800, bundled `/fonts/plus-jakarta-sans.woff2`) with Segoe UI Variable → system-ui fallback.
**Body Font:** Plus Jakarta Sans — one family across the whole UI.
**Label/Mono Font:** JetBrains Mono (variable 400–700, bundled) with Cascadia Mono / Consolas fallback.

**Character:** one warm geometric sans from 10.5px micro-labels to 16px titles, with all machine output (hashes, numstats, counts, diff lines) dropping to JetBrains Mono at 10.5–11px.

### Hierarchy
- **Headline** (700, 16px, ~1.3, tracking-tight): app/modal titles — EmptyState heading, "Settings".
- **Title** (600–700, 12.5px): commit subjects, panel headings inside details, card labels.
- **Body** (400, 14px base / 12px secondary, 1.5): descriptions, settings hints, empty-state copy.
- **Header label** (600, 11.5px): commit-table column headers — dim ink, uppercase-free.
- **Label** (600–700, 10.5px, tracking 0.08em, uppercase where status-like): structural pills, status badges, tiny captions.
- **Mono data** (400–700, 10.5–11px): every metric, hash, count and diff payload.

### Named Rules
**The Visible Ladder Rule.** The jump between ranks must be felt: 16 → 14 → 12.5 → 10.5px with weight doing the separating, never spacing alone. If two ranks would render the same size, merge them.
**The Mono-for-Data Rule.** Anything git produced numerically or as a hash is mono; prose never is.

## Layout

A fixed desktop shell, resized by the user, not by breakpoints. A 40px undecorated title bar (acting as window chrome: brand, tabs, toolbar, caption buttons) sits directly on the aurora canvas; below it a flex surface holds the commit list and the details panel.

The commit table is a grid whose shared tracks live in `tableLayout.ts`: graph gutter (fit-mode width from `layout.laneCount`, capped at 6 lanes; draggable 28px→natural+280px, absolute-pinned), message (160–1200px), author (72–280px), date (112–220px), hash (74px). Rows are exactly 32px tall (`ROW_HEIGHT`) with a 16px lane step (`LANE_WIDTH`) — shared by the SVG graph and the rows so dots can never drift off their lines.

The sidebar is 360px (260–640), details height 360px (160–760). Internal paddings are small: `p-3` blocks inside panels, `gap-2`/`gap-3` between cards, `px-3.5 py-2` on list headers. Density is airy: type size and colour make the seams, not thick borders. The builder-of-record is `PANEL` (glass + blur, 16px radius); anything interactive floating on the canvas gets `GLASS_CONTROL` backing.

## Elevation & Depth

Depth is conveyed by *layered translucency*, not shadows: the aurora canvas glows, glass panes at 55–88% alpha stack over it, a `backdrop-blur` smears the field behind each pane, and a bright hairline + inset top highlight makes every edge legible. Shadows exist only as ambient fare — soft, low-saturation violet-tinted lifts that nod to glass thickness, never hard contact shadows.

### Shadow Vocabulary
- **Panel shadow** (`box-shadow: var(--shadow-panel)` = `inset 0 1px 0 0 rgb(255 255 255 / .85), 0 14px 34px -26px rgb(48 36 100 / .45)`; dark: `inset 0 1px 0 0 rgb(255 255 255 / .09), 0 18px 40px -28px rgb(0 0 0 / .9)`): major glass panes only.
- **Soft shadow** (`var(--shadow-soft)` = `0 6px 16px -10px rgb(48 36 100 / .4)`, dark `0 6px 16px -10px rgb(0 0 0 / .8)`): small controls, toggle knobs, active tabs.

### Named Rules
**The Depth-From-Field Rule.** A new surface gets glass + the canvas glow field, never a heavier shadow. Adding drop-shadow depth fails the design; adding a slightly different glass layer succeeds.
**The Var-Route Rule.** Shadows must ship as the custom `@utility panel-shadow` / `soft-shadow` utilities, never as Tailwind's `shadow-panel`/`shadow-soft` — Tailwind v4 inlines `@theme` literals into utilities, so `.dark` overrides would silently never apply. The custom utilities' `var()` indirection is the only reason themed shadows work.

## Shapes

Soft glassware: large-radius containers, mostly-full small controls. Panels are 16px radius (`rounded-2xl`), inner blocks and split cards 12px (`rounded-xl`), buttons/fields/tabs 8px (`rounded-lg`), status cubes 4px (`rounded-[4px]`), pills and toggles fully round. Internal borders are 1px `border-rule`; glass edges are 1px `border-hairline`. The only heavy border in the system is the outline ref pill's 1.5px lane-coloured ring — and it must literally be spelled `border-[1.5px]` (Tailwind's `border-1.5` is not a utility and silently renders 0px). Binary states are round: pills, toggle tracks, icon buttons stay `rounded-full`; squares-in-system are 4–8px status cubes and buttons only.

## Components

### Buttons
- **Shape:** 8px radius; 6px 12px padding; 12px 600 text.
- **Primary:** `bg-primary text-white soft-shadow hover:brightness-110` — the single filled CTA ("Restart to apply update", confirm primary).
- **Glass secondary:** `border-hairline bg-glass-strong text-ink hover:bg-hover-glass` — the default quiet action.
- **Danger:** `border-danger/30 bg-danger/15 text-danger-ink hover:bg-danger/25` — confirm-dialog non-destructive-side twin of glass, rose not violet.
- **Text/icon ghost:** bare `text-ink-dim hover:bg-hover-glass hover:text-ink` with `focus-visible:ring-2 ring-primary/70` — toolbar and header icon buttons sit in 7px boxes (`size-7`) so the wash has an edge to fill.
- **Disabled:** `opacity-60` uniformly; no greying palette shifts.

### Ref Pills (signature component)
- **Shape:** 20px tall, full radius, 10.5px leading-none, icon 10px, px-2, shrink-0.
- **Current (checked-out):** filled `laneColor` with `text-surface` bold.
- **Outline:** transparent fill, 1.5px `laneColor` border, text `color-mix(in oklab, laneColor, var(--color-ink) 55%)` — the mix keeps contrast at small sizes over both themes.
- **Behaviour:** double-click checkout on local branches; right-click menu per-pill; remote label appended after a 1px divider in pill text colour.

### Cards / Containers
- **Corner Style:** 16px glass panels (`PANEL`), 12px inner sections (`rounded-xl border-rule bg-sheet p-3`).
- **Shadow Strategy:** panel-shadow only, per Elevation.
- **Internal Padding:** 12px inner blocks, 14px list headers (`px-3.5 py-2`).

### Inputs / Fields
- **Style:** glass field — `h-7 rounded-lg border-transparent bg-glass-soft text-ink-soft` inside the title bar (search, CSS-only summary rows); focus-visible rings `ring-primary/70` with `ring-offset-transparent`.
- **Toggles:** 40×22px track, full radius, `bg-primary` on / `bg-ink/15` off; white 18px knob with `soft-shadow`.

### Status cubes (signature micro-component)
- **Style:** 18px (w-4.5 h-4.5), 4px radius, mono 10.5px bold single letter — the A/M/D/R badges on changed files. Tone pairs: `bg-warning/15 text-warning-ink` (modified), success/danger siblings in the same 15%/ink pattern.
- **Behaviour:** never status-words; the letter is the label, `title` carries the full text.

### Tab strip
- **Style:** h-7 rounded-lg glass chips with shimmer transitions across `background-color, border-color, color, box-shadow, opacity`; active state = `border-hairline bg-glass-strong text-ink soft-shadow`; sleeping tabs fade to 55%`; clip labels fade via `tab-fade` mask.
- **Order affordance:** dnd sortable, drag overlay, pointer sensors only (keyboard sensor steals Space/Enter — forbidden).

## Do's and Don'ts

### Do:
- **Do** reference `--color-*` tokens from components only, and re-point them under `.dark` — reintroduce zero hex in TSX (AGENTS.md rule 1).
- **Do** ship shadows exclusively through the `panel-shadow` / `soft-shadow` custom utilities.
- **Do** tint any interactive element floating on the aurora with `bg-glass-soft` + `backdrop-blur-md` (TitleBar chrome rule).
- **Do** pair a loud colour with its `*-ink` variant for small text; never raw `text-warning` on glass.
- **Do** keep binary components round (pill/toggle/button-full) and chrome square-ish (8–16px).
- **Do** build data rows as fixed grids out of `tableLayout.ts` constants; 32px per row, 16px per lane.

### Don't:
- **Don't** reintroduce the saturated violet→rose aurora canvas — it was replaced by the white canvas with corner glows (light) and white halos on the deep canvas (dark).
- **Don't** use Tailwind's `shadow-panel` / `shadow-soft` or type `border-1.5` — use `panel-shadow`/`soft-shadow` and `border-[1.5px]`.
- **Don't** invent a second accent family or a saturated theme colour from a mock palette (theme previews that use literal colours are the sanctioned exception).
- **Don't** hide an affordance behind hover only — visible at rest, strengthened on hover, but never hover-only discovery.
- **Don't** put a `dark:` variant in a component span; if a component needs a different shade per theme, add a token.

### Graph rules:
- **Don't** colour a component with a hue the lane didn't earn — graph colour is lane-owned; take it from `laneColor(k)` in `graphGeometry.ts`, never invent one.
- **Don't** let a label, pill or line carry a colour from its previous lane after a bend.
