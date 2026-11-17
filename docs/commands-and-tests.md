# Commands and tests

```bash
npm run build        # gate for frontend work: tsc && vite build (run this before claiming done)
npm run lint         # tailwind hygiene autofix over src (eslint-plugin-tailwindcss); run after CSS-class changes
npm run lint:check   # same rules without fixing (CI-style check)
npm test             # vitest: graph regression, parsers, gitLoader (mocked invoke), components, App
npm run dev          # vite dev server on http://localhost:1420
npm run tauri dev    # desktop window
cargo check          # in src-tauri/; gate for Rust work
cargo test           # in src-tauri/; git.rs against real throwaway repos (runs git CLI)
```

`npm test` is Vitest; unit and component tests sit next to their source (`src/**/<file>.test.ts(x)`), the App integration slice lives in `tests/`. Component and App tests need jsdom
(`// @vitest-environment jsdom` on the file) and stub `window.__TAURI_INTERNALS__` +
`ResizeObserver`; `@tauri-apps/api/core` is mocked with `vi.mock(..., () => ({ invoke: vi.fn() }))`.
`cargo test` builds throwaway git repos under the OS temp dir — keep them self-contained
(no remote network, cheap fixtures). Rust tests mirror the TS rule: `src-tauri/src/git/<x>.rs`
is tested by `<x>_tests.rs` beside it (wired in `mod.rs` as `#[cfg(test)] mod <x>_tests;`, named
exactly after the module); the one with no module of its own is `sync_tests.rs` (push/pull,
which live in `mod.rs`). Shared fixtures (`TempRepo`, `git`, `git_out`, `bare_repo`,
`conflicting_repo`) live in `test_support.rs` — a test file never imports another test file.
There is no monolithic `tests.rs`; a new test goes with the module whose `*_in` it calls.
Cross-command workflows would go in `src-tauri/tests/` (integration crate, public API only) once
the git module is exposed; none exist yet. `npm run lint` is a Tailwind class checker, not a code
linter. `npm run build` + `npm test` + `npm run lint:check` + `cargo test` pass = verifiable state.
`.github/workflows/ci.yml` runs exactly that gate on every push and pull request (ubuntu runner:
`npm ci`, lint, build, vitest, then `cargo test` — tauri-build needs `dist/`, hence the build first),
and the README's Tests badge points at it.
