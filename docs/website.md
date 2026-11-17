# Website (`website/`)

Astro 5 + Tailwind v4 landing site (one React island: `ThemeSlider`, the
light/dark comparison dragger). Deploys on Netlify; `netlify.toml` at the repo
root sets `base = "website"`. Gate: `npm run build` + `npm run check` inside
`website/`.

- Tokens in `website/src/styles/global.css` are copied from `src/index.css`
  `@theme` (light values only — the site never renders dark). Re-copy on token
  retunes; fonts and screenshots in `website/public/` mirror the app the same way.
- The teach-sweep in `ThemeSlider` is skipped under `navigator.webdriver`, so
  headless captures always see the neutral 50% divider.
- Mobile overflow rule from the first build: a flex child with an intrinsic
  width (the demo graph SVG) drags the whole grid wider — give it a definite
  width (`w-40 md:w-56`); `min-w-0` cannot shrink below a child's min-content
  contribution. Verify with `scrollWidth === clientWidth` at 390px.
- Deploy wiring (Netlify site + DNS) is deliberately NOT documented here —
  it is per-machine ops, kept out of the public repo.
