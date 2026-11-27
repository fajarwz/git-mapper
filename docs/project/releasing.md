# Releasing

- **Releases feed the updater.** `tauri.conf.json` points at
  `github.com/fajarwz/git-mapper/releases/latest/download/latest.json`. To ship one: bump
  `version` in `tauri.conf.json` (keep `package.json` and `Cargo.toml` — and `Cargo.lock` via
  `cargo update -p git-mapper` — in step), commit, then push a `v*` tag: `.github/workflows/release.yml`
  builds every platform, signs with the key stored in CI, and opens a DRAFT release with
  `latest.json` attached. macOS is ONE `universal-apple-darwin` build (one dmg for Apple
  Silicon + Intel); a `publish` job then trims the draft to three versionless installers
  (setup.exe / dmg / AppImage — the names the README links to) plus the macOS updater
  artifact, renamed to `Git.Mapper.app.tar.gz`: it repoints `latest.json`'s URLs at those
  uniform names and prunes every `.sig`/versioned duplicate. Publish the draft with real
  changelog notes
  (`gh release edit v<ver> --draft=false --latest --notes-file <file>`) and verify the feed answers
  `HTTP 200` with the new version.
  **Notes have two sections.** `## Highlights` holds the two to four headline features, each a
  bold lead plus a sentence on what the user can now do (benefit, not mechanism); skip the
  section when a release has no real headline. `## Improvements and fixes` is one flat list of
  the small stuff (split into Improvements / Fixes past ~8 items). Draft from
  `git log --format=%s v<prev>..v<ver>`: `feat` commits seed Highlights or Improvements, `fix` and
  `style` the rest; refactor/test/docs/chore commits are left out. Write for users, not commit
  subjects. End with `**Full changelog:** https://github.com/fajarwz/git-mapper/compare/v<prev>...v<ver>`.
  Pass the body with `--notes-file` — an inline `--notes "…"` mangles the markdown and backticks. The private signing key lives OUTSIDE the repo and never gets
  committed. The app checks that feed at launch when "Update
  automatically" is on (the default), downloads in the background (never installs on its own: `download()`, then `install()` on the click, so a
  Windows install cannot close the app unasked; `installMode` is pinned to passive), and the settings modal offers
  "Restart to apply update" (`tauri-plugin-updater` + `tauri-plugin-process` + the gear dot).
