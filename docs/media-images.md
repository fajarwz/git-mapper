# Marketing images (`docs/media/`)

The floating-component screenshots (website hero, README header, social preview) are generated, never
edited by hand. One command retakes the app screenshots and rebuilds every output:

```
cd video
npm run shots            # capture from the real app, then render everything
npm run shots -- render  # skip the capture, re-render from docs/media/sources
npm run shots -- video   # only the 8 s hero loop (about 3 minutes)
npm run shots -- social  # only the captioned social video (about 90 seconds)
```

Needs Edge or Chrome and `ffmpeg` on PATH; starts `npm run dev` itself when :1420 is free and stops it after.

| Output | Used by |
| --- | --- |
| `website/public/screens/hero-floating.webp` (transparent) | website hero, `index.astro` |
| `website/public/screens/hero-floating.webm` (transparent, 8 s loop) | website hero `<video>`; the WebP above is its poster and the reduced-motion still |
| `docs/media/floating-screenshot.mp4` (opaque, 1600×712) | social posts and release notes; X, LinkedIn and Reddit do not take transparency |
| `docs/media/social-video.mp4` (1600×840, with logo, headline, subtitle and badges) | the video to post on X, LinkedIn and Reddit; headline text animates in with the window |
| `website/public/screens/og-image.png` (1200×630) | social preview, `Site.astro` |
| `docs/media/floating-screenshot-bare.png` | README header |
| `docs/media/floating-screenshot.png`, `…-transparent.png` | spare: with headline / lossless transparent |

- **Pipeline:** `video/scripts/shots.mjs` drives the app against the demo repo from `make-demo-repo.mjs`
  (light theme, 2× scale) into `docs/media/sources/`, then opens `docs/media/floating-screenshot.html`
  once per output. The page's URL hash picks the layout: `#full`, `#bare`, `#bare-clear`, `#og`. Adding `motion` (`#bare-clear-motion`, `#og-motion`) builds the timeline; the page exposes `window.seek(ms)` and `shots.mjs` screenshots 240 frames at 30 fps into ffmpeg.
- **Change the look** (headline, pill text, card positions) in `floating-screenshot.html`, then run
  `npm run shots -- render`. **Change what the app shows** by editing the capture steps in `shots.mjs`.
- **Re-run after any visible UI change**, or the images drift from the app. The capture finds elements by
  accessible name (`Stage metrics.ts`, `Pick…`, the context menu), so a renamed control fails the run loudly.
- The captures show the repo name `orbit-demo` and its demo commits; that is expected.
