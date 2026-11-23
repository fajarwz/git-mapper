# Marketing images (`docs/media/`)

The floating-component screenshots (website hero, README header, social preview) are generated, never
edited by hand. One command retakes the app screenshots and rebuilds every output:

```
cd video
npm run shots            # capture from the real app, then render everything
npm run shots -- render  # skip the capture, re-render from docs/media/sources
```

Needs Edge or Chrome and `ffmpeg` on PATH; starts `npm run dev` itself when :1420 is free and stops it after.

| Output | Used by |
| --- | --- |
| `website/public/screens/hero-floating.webp` (transparent) | website hero, `index.astro` |
| `website/public/screens/og-image.png` (1200×630) | social preview, `Site.astro` |
| `docs/media/floating-screenshot-bare.png` | README header |
| `docs/media/floating-screenshot.png`, `…-transparent.png` | spare: with headline / lossless transparent |

- **Pipeline:** `video/scripts/shots.mjs` drives the app against the demo repo from `make-demo-repo.mjs`
  (light theme, 2× scale) into `docs/media/sources/`, then opens `docs/media/floating-screenshot.html`
  once per output. The page's URL hash picks the layout: `#full`, `#bare`, `#bare-clear`, `#og`.
- **Change the look** (headline, pill text, card positions) in `floating-screenshot.html`, then run
  `npm run shots -- render`. **Change what the app shows** by editing the capture steps in `shots.mjs`.
- **Re-run after any visible UI change**, or the images drift from the app. The capture finds elements by
  accessible name (`Stage metrics.ts`, `Pick…`, the context menu), so a renamed control fails the run loudly.
- The captures show the repo name `orbit-demo` and its demo commits; that is expected.
