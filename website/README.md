# Git Mapper website

Landing site for [Git Mapper](https://github.com/fajarwz/git-mapper). Astro 5 static
shell + Tailwind v4, one React island (`ThemeSlider`, the light/dark comparison
dragger). Everything else is prerendered HTML for SEO.

## Develop

```bash
cd website
npm install
npm run dev        # http://localhost:4321
npm run build      # static output in dist/
npm run check      # astro check (type diagnostics over .astro/.tsx)
```

## Deploy

Deployed on Netlify. Build settings live in the root `netlify.toml`; domain
and DNS setup is handled out-of-band (not part of the public repo).

## Keep in sync with the app

- `src/styles/global.css` carries the design tokens copied from the app's
  `src/index.css` `@theme` (light values only — the site renders light-only).
  A token retune in the app must be re-copied here.
- `public/fonts/` are the same files the app ships in `public/fonts/`.
- `public/screens/main-{light,dark}.png` are resized (2240px) copies of
  `docs/screenshots/main-*.png`. Re-copy + resize with ImageMagick after a
  fresh screenshot pair lands.

Do NOT import app components into the site: different runtime, different
build. Tokens and fonts are the shared surface, on purpose.
