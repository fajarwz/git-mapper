# Git Mapper: real Git plumbing

> **For Hermes:** implement task-by-task, keep the gate honest (`cargo check` + `npm run build`), do not commit unless asked.

**Goal:** Replace the hardcoded mock repositories with real Git data: open any folder as a new repo tab, load real commits + refs + graph lanes live, and show real changed files + diffs for the selected commit.

**Architecture:** Rust (Tauri) executes the `git` CLI via `std::process::Command` and returns raw porcelain output. TypeScript pure parsers (in `src/lib/`) turn that into the existing `Repository`/`Commit` types, so the UI components barely change. Files + diffs load lazily per selected commit instead of being bundled into the commit list — a real repo has thousands of commits and diffs are far too heavy to preload.

**Tech stack:** Tauri 2 (existing), `tauri-plugin-dialog` (folder picker), `@tauri-apps/plugin-dialog`, the system `git.exe` (no `git2` crate — CLI output is parseable and keeps the build lean).

**Key decisions (agree before/while executing):**
- `git` CLI, not `git2`: the machine has git, output is stable porcelain, Rust stays thin.
- Parsing lives in TS (`src/lib/*.ts`), Rust only runs git and returns strings. Pure TS is cheap to exercise with node against this repo's own output.
- Table stays as-is (it already handles real columns); lane computation replaces the authored `lane` field.
- Empty state on launch, not the mock repos. First run auto-opens this repo (`C:\DATA\lab\tauri\git-mapper`) so dogfooding starts immediately; open tabs persist in `localStorage`.

**Gate:** `cargo check` (in `src-tauri/`) and `npm run build` after every phase. No test infra in this repo — parsers get verified with throwaway node scripts against real git output (see each task). Final check: run `npm run tauri dev`, open this repo, compare the commit list against `git log --oneline`.

---

## Task 0: Dialog plugin

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `tauri-plugin-dialog = "2"`)
- Modify: `src-tauri/src/lib.rs` (`.plugin(tauri_plugin_dialog::init())`)
- Modify: `src-tauri/capabilities/default.json` (add `"dialog:default"`)
- Modify: `package.json` (`npm install @tauri-apps/plugin-dialog`)

Verify: `cargo check` passes; `npm run build` passes.

## Task 1: Rust git commands module

**Files:**
- Create: `src-tauri/src/git.rs`
- Modify: `src-tauri/src/lib.rs` (register commands)

Helper + three commands, all returning strings or a serde-serializable struct. Never shell out with a user-controlled path in a shell; use `Command::new("git").args(...)` with `current_dir(path)`.

```rust
fn run_git(dir: &str, args: &[&str]) -> Result<String, String> {
    Command::new("git").args(args).current_dir(dir)
        .output().map_err(...)
        .and_then(|out| {
            if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).to_string()) }
            else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
        })
}
```

- `#[tauri::command] open_repository(dir: &str) -> Result<RepoInfo, String>` — validate: `run_git(dir, &["rev-parse", "--is-inside-work-tree"])` must be `true`; get toplevel from `git rev-parse --show-toplevel`; name = last path segment of toplevel. Returns `{ path, name }`.
- `read_status(dir) -> StatusInfo` — `git status -sb`: first line `## branch...origin/branch [ahead 1, behind 2]`. Returns `{ branch, ahead, behind }` (0s when no upstream).
- `read_log(dir, limit: u32) -> String` — raw records for TS to parse:
  `git log --max-count=<limit> --date=iso-strict --pretty=format:%H%x00%an%x00%ae%x00%aI%x00%B%x1e%d%x1e` then a second field for parents: append `%x00%p` only via format `--pretty=format:...`. One commit = one record; record separator is the format's leading delimiter. Use this exact format so TS parses deterministically (subject/body need `%B` because subjects contain everything).
- `read_commit_files(dir, hash: &str) -> FilePayload` — two calls: `git diff-tree -r --no-color --numstat` for per-file counts (also `git diff-tree -r --no-color --name-status <hash>` for status letters), and `git diff-tree -p --no-color <hash>` ~first-parent (`git show --root <hash>` for root commits). Returns `{ numstat, nameStatus, diff }` raw strings.
- Delete the `greet` command.

Verify: `cargo check`. Manual: comment-in a `#[cfg(test)]`? No test infra — instead verify in Task 2 via the running app; here only `cargo check`.

## Task 2: TS parsers (pure, no React)

**Files:**
- Create: `src/lib/gitLogParser.ts` — string records → `{ hash, author, authorEmail, date, subject, body, parents, rawRefs }[]`. Splits on `\x00`; refs trailer parses `HEAD -> main, origin/main, tag: v1` into `CommitRef[]` (`branch` vs `remote`: starts with `origin/`; `tag:`; `HEAD -> x` is the current branch → `isCurrent: true`).
- Create: `src/lib/gitStatusParser.ts` — status band → `{ branch, ahead, behind }`.
- Create: `src/lib/gitDiffParser.ts` — numstat + nameStatus + unified diff → `ChangedFile[]`. Key rules: `numstat` lines are `adds\tdeletes\tpath` (binary = `-` dashes, renames embed `{old => new}`); body lines become `type: hunk|context|add|remove` with the leading `+`/`-`/space STRIPPED (the renderer adds prefixes back; data must stay honest). Parse `@@ -a,b +c,d @@` into hunk rows so the diff header/gutter structure stays as the mock renderer expects.
- Create: `src/lib/graphLanes.ts` — replaces the authored `lane` field. Greedy lane assignment walking commits newest→oldest: a commit reuses the lane its parent reserved; a parent previously reserved by an already-placed child stays put; lowest freed/new lane otherwise. Keep it a 30-line loop; don't over-engineer a real layout engine yet.

Verify: run all three parsers against real output (`git log` / `git diff-tree` in this repo) with a throwaway node script — `npx vite-node <script>` (ships with the vite install) so the TS parsers run directly, no new deps.

## Task 3: Loader + App wiring

**Files:**
- Create: `src/data/gitLoader.ts` — functions using `invoke()`:
  - `openRepository(): Promise<Repository|null>` — creates the RT `Repository` object: opens folder via `@tauri-apps/plugin-dialog` (`open({ directory: true })`), cancels = null; then calls `open_repository`, `read_status`, `read_log(500)`; computes lanes via `graphLanes`; fills `refs` and computes `relativeDate` (simple rule: seconds→\"just now\", minutes, hours, days, weeks, else absolute short date); `defaultCommitHash` = first row.
- Modify: `src/types.ts` — `Repository`/`Commit` lose `lane` (computed in loader), `Commit.files` removed (lazy), no more constructed-length list.
- Modify: `src/App.tsx` — state moves from the `repositories` import to `Repository[]`. On mount: restore open repos from `localStorage` (`git-mapper:open-repos`); if empty and first run, auto-open this repo's absolute path. Pass `setRepos`/`setActiveRepoId` down to the tabs via an `onAdd` callback.
- Modify: `src/components/RepoTabs.tsx` — enable the `+` button → calls `openRepository()`, refuses duplicate paths, shows a temporary loading tab while the first log loads. Delete the "Opening a repository is not part of this UI-only build" disabled state; a small ✕ close on tabs lands here too.
- Modify: `src/components/Toolbar.tsx` — path pill now binds the active repo's path; delete the `mock data` pill and the `repositories` import; optional Refresh button (same GLASS_CONTROL styling) re-running status/log for the active repo — defer if scope creeps.
- Create: `src/components/EmptyState.tsx` — centred glass panel shown when `repos.length === 0`: big dashed + button, "Open a folder with Git Mapper". Reuses PANEL/soft-shadow.

Verify: `npm run build`; run `npm run tauri dev`, open this repo, confirm the commit count matches `git log --oneline | wc -l`, branch pill shows `main`, ahead/behind match `git status -sb`.

## Task 4: Details panel + real files/diffs

**Files:**
- Modify: `src/components/DetailsPanel.tsx` — receives `repo.path` + `commit.hash`, calls `read_commit_files`, owns local `selected` (lifted back to App via `onSelectFile` already), shows a subtle spinner row while loading; decorations, additions/deletions remain visible on all row types.
- Modify: `src/components/DiffViewer.tsx` — real diff lines can be huge: `max-h` overflow scroll, content garbles long lines? check `break-all`/`whitespace-pre-wrap`; remove the mock-focused parts.
- Delete: mock datasets (`src/data/repositories.ts`, `src/data/gitMapperRepo.ts`, `src/data/ledgerApiRepo.ts`) once nothing imports them; keep `types.ts` (now fed by the loader).

Verify: `cargo check` + `npm run build`; click the first commit → files appear; deep-diff a file with big changes; a merge commit (~first parent) and root commit (diff-tree --root) don't crash.

## Task 5: cleanup + docs

- Delete: `src/data/repositories.ts` and its mock sub-datasets once nothing imports them; update AGENTS.md architecture section (mock data → real git plumbing, the new Tauri commands/list, the ROW_HEIGHT pitfall stays).
- Verify: `git status --short` shows only intended paths; `cargo check`; `npm run build`; tauri dev run — open a second tab, switch tabs, close a tab, restart the app (tabs restored), check light and dark themes.

---

## Not in this PR (deferred on purpose)
- File snapshots/diff gutter numbers (mock renderer needs none).
- Staging-area/unstaged changes view.
- Search/filter, `graph_scroll` pos restore, remember latest commit per tab instead of first.
- Close = only via the little ✕ active-tab close button; drag-reorder tabs later.

## Risks / tradeoffs already handled
- `git` parsing of subject/body with newline: `%B` may contain NEWLINES. Record format uses leading `%d%x1e` delimiters, but `%B` chunks could contain the delimiter by freak accident — acceptable for a viewer (log split at `x1e` first, then `%n` between fields).
- Non-ASCII authors/paths come back as bytes — `from_utf8_lossy` in Rust, plain strings in TS; no decoding bugs expected.
- `read_log` 500-cap commit output is one string per commit; large repos will need incremental/lazy paging later — noted, deliberately deferred.
- lane naive algorithm: fine for typical history; a proper layout engine is separately listed in the old roadmap, don't confuse the two.
