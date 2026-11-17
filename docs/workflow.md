# Branches, commits and PRs

- **Branch names are `<type>/<kebab-slug>`**, with the same types the commit subjects use: `feat/`,
  `fix/`, `docs/`, `chore/`, `style/`, `perf/`, `refactor/`, `test/` (`feat/merge-resolution`,
  `fix/stash-row-anchor`). One branch per change; the type is the dominant one when a branch mixes.
- **Commit subjects are `type(scope): subject`**, scope optional (`feat(git): …`, `fix: …`). Commit
  per domain (backend, UI, docs, config), each one buildable on its own where the files allow it.
- **A PR's title follows the same `type(scope): subject` form**, and its body says what changed,
  what was verified, and what was not.
- **No attribution lines** (no `Co-Authored-By`, no "Generated with …") in commits or PR bodies.
