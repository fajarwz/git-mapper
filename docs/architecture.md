# Architecture

## Layout of `src/`

- `features/<name>/` — one folder per feature (`history`, `diff`, `staging`, `conflicts`, `pull-requests`, `submodules`, `details`, `shell`). A feature stays flat until it passes about 8 files; then it splits into `components/` (React components), `hooks/` (`use*.ts`) and `lib/` (pure TypeScript: parsers, layout math — no React, no Tauri). Today `history`, `diff` and `pull-requests` are split; the rest are flat. Tests sit beside their source.
- `shared/components/` and `shared/lib/` — generic components and helpers (including hooks like `useExit`, `usePersistedState`) used by more than one feature. `shared/` never imports from `features/`.
- `data/gitLoader.ts` — the only `invoke()` surface. `App.tsx`, `main.tsx`, `types.ts` and `index.css` stay at the root.
- Pure `lib/` files must not import React or `@tauri-apps/*` (enforced in `eslint.config.mjs`).
- Do not put two files in one folder whose names differ only by case or extension (`StarPrompt.tsx` next to `starPrompt.ts` broke `tsc` on case-insensitive filesystems); the pure half is `starPromptState.ts`.

- `src/App.tsx` — shell: `TitleBar` row (40px) over a flex-1 content area holding the commit list + details panel, per-repo selection state, details-panel open/height state. `Repository[]` lives in state (open tabs persisted to `localStorage` under `git-mapper:open-repos`, written only after the first load lands); empty state = `EmptyState.tsx`. Open/checkout/restore failures surface as a bottom-right toast (`Toast.tsx`, auto-dismisses in 6s) — with tabs open the empty state never renders, so an error line there would never be seen. Memory: the changed-files cache is an LRU (`FILES_CACHE_CAP` in `gitLoader.ts`), a tab inactive past `SLEEP_AFTER_MS` drops its history (`sleeping` flag; dimmed pill, reload on click), and closing a tab evicts its cache entries.
- **Back/forward works across tabs, like VS Code.** `shared/lib/navigationHistory.ts` is the pure list (a location is `{repoId, commitHash, filePath}`; push drops the forward entries, dedupes, caps at 100) and `features/shell/useNavigationHistory.ts` wires it: it records a selection only after it has held for `NAV_COALESCE_MS` (arrow-key scrubbing is one entry), flushes the pending one before a step, and ignores the selection changes a replay itself causes. `App.handleNavigate` applies a location (switch/wake the tab, select commit and file, close the conflict view); entries for closed tabs or commits a rebase removed are skipped, a sleeping tab is trusted until it wakes. Alt+Left/Right, the mouse side buttons and the title-bar arrows drive it. History is in-memory only.
- `src/features/shell/BootScreen.tsx` — launch screen. `App` starts `booting` true whenever `readStoredPaths()` finds saved tabs (synchronous, so the decision exists before the first paint) and clears it in the hydration effect's `finally`. While it is up the content area shows the brand + dots, **not** `EmptyState` — the open-folder card must only ever mean "no repositories are open", never "still loading". Fresh installs skip it. Dots animate via the `boot-dot` utility in index.css.
- `src/features/shell/TitleBar.tsx` — the window IS undecorated (`decorations: false` in `tauri.conf.json`), so this bar doubles as the title bar: brand, repo tabs (Chrome-style shrink + `tab-fade` on clipped labels), toolbar actions (a search icon button that toggles the floating find bar — see `FindBar.tsx` — plus a refresh button whose glyph spins for at least 550ms so a fast local read still reads as work, and settings) and the caption buttons. Tabs reorder through `@dnd-kit/sortable` (`horizontalListSortingStrategy` + `DragOverlay`); the sensors are **pointer only**, because the keyboard sensor claims Space/Enter on the focused tab and a tab must stay activatable from the keyboard. HTML5 drag-and-drop is not an option here: the webview routes drag events to Tauri's file-drop handler. `data-tauri-drag-region` covers the bar background and the tab strip; the caption buttons need the `core:window:allow-*` entries in `src-tauri/capabilities/default.json`.
- `src-tauri/src/git.rs` — Tauri commands running the `git` CLI: `open_repository` (validates + toplevel/name), `read_status` (branch / ahead / behind / head + the worktree digest), `read_refs` (`hash	fullref` lines), `read_log` (porcelain fields `\x00`-separated, records `\x1e`-separated, decorations lead each record), `read_log_delta` (`git log --all ^<head>`), `read_log_order` (hashes only, for splicing),
  `read_wip_side` + `apply_hunk` (hunk-level staging, `git/hunks.rs`),
  `read_commit_files` (numstat + name-status + patch, first-parent; root via `--root`; the
  pseudo hash `wip` means the working tree; one `rev-list --parents -1` probe sets root and
  the `stash -u` third parent, and the diff spawns run concurrently on scoped threads via
  `parallel_git` — keep new reads in that batch, never serial. The wip reads stat the
  worktree and run lock-free (`run_git_no_locks`, `GIT_OPTIONAL_LOCKS=0`) so concurrent
  `git diff HEAD` calls cannot collide on index.lock; NEVER set that env on `git_command`
  globally — the opportunistic index write it suppresses is the stat cache every later
  read hits, and without it a WSL mount re-scans the whole tree (~20s) on every call), `checkout_branch`. Folder picking is JS-side via `tauri-plugin-dialog` (`dialog:default` capability).
  Every command is a thin async wrapper (`run_blocking`, String args) around a sync `*_in` body:
  a sync `#[tauri::command]` runs on the main thread, and one slow read (a ~20s `git status` over
  a `\\wsl.localhost` mount) greyed the whole window out with "Not responding". Tests call the
  `*_in` bodies directly — no `block_on` needed.
- `src/data/gitLoader.ts` — the only `invoke()` surface: `loadRepository`, `pickAndLoadRepository`,
  `refreshRepository`, `loadCommitFiles`, plus persisted-path storage. Build the `Repository`/`Commit`
  objects there; components stay invoke-free.
- **Refresh is surgical.** `refreshRepository` runs two cheap reads (`read_status`, `read_refs`) and
  compares branch + HEAD + dirty size + the **worktree digest** + a digest of every ref.
  Unchanged → `null`, no state update. The digest is why the uncommitted row updates at all: the
  dirty *count* stays put while a file is edited, so `read_status` also hashes the status list,
  the tracked `git diff HEAD` and the size/mtime of every untracked file.
  A moved HEAD *or* a moved ref triggers `read_log_delta` (`git log --all ^<oldHead>`): a fetch that
  only adds a branch leaves HEAD alone but its commits are still new to the window. The delta is
  spliced in **git's own order** (`read_log_order`, `git log --all --format=%H`), because a branch
  pushed late can carry commits older than rows already on screen. Empty delta with a moved HEAD, or
  a full page, means history was rewritten or the window shifted → `loadRepository`. Unchanged
  commits keep object identity (`withLanes`, `sameRefs`) so the memoized `CommitRow` skips their
  render, and the return value lists the rows a caller should flash (`touched`) — the
  uncommitted row included, since it is rebuilt from scratch instead of coming out of the delta.
  `refreshRepository(repo, force)` only drops the early exit: that is the toolbar refresh
  button, and it is what makes the uncommitted row refetch through its new digest key.
- **The uncommitted row owns its file list.** `git diff HEAD` never lists untracked paths, so
  `read_commit_files(dir, "wip")` appends numstat/name-status/patch entries for every
  `git ls-files --others --exclude-standard` path (binary → a "not shown" hunk). The dev
  middleware (`dev/gitApi/files.ts`, `status.ts`) mirrors this and the worktree digest — keep the
  two in sync.
- `dev/gitApi/` — the browser-tab stand-in for the Tauri commands, served by a Vite plugin as
  `POST /api/git`. One file per Rust module (`status`, `log`, `actions`, `merge`, `hunks`,
  `staging`, `files`), each exporting a `<module>Handlers` map; `index.ts` merges them and owns
  the HTTP handler, `git.ts` holds `run` and the `Handlers` type. A new command goes in the file
  named after its Rust module. `vite.config.ts` stays config only. Files are imported with their
  `.ts` extension (Vite's future native config loader needs it), and nothing type-checks this
  folder in CI, so probe a new handler with `curl` against `npm run dev`.
- Pure parsers in each feature's `lib/` folder — `gitLogParser`, `gitDiffParser` (DiffLine text carries NO +/- prefix; the renderer adds it), `graphLanes` (git-shaped layout: dense lanes, tips append on the right, merge parents fork just right of the commit, closed lanes shift the rest left, and a commit reserved by several children keeps the leftmost and joins the rest — `MAX_LANES` is a hard width cap). All pure, no React — verifiable with `npx vite-node <probe>` against real git output.
- Changed files/diffs load lazily per selected commit (`App` keeps `filesByCommitHash`); the commit list never carries them.
- `src/features/diff/components/DiffViewer.tsx` — the diff pane has two scopes (`DiffScope`): `file` shows the
  selected file alone (the default), `all` stacks **every** changed file into one scroll with a
  sticky per-file header, so a whole commit can be read without a click per file. In `all` scope the
  file list on the left becomes a jump list: selecting a file scrolls its section into view (guarded
  `scrollIntoView`, jsdom has none). Each file keeps its own `DiffBody`, so highlighting follows that
  file's grammar rather than the previously selected file's. The body mounts are keyed by path —
  reusing the instance across files painted the previous file's token HTML onto the new file's rows
  while the new grammar loaded. Image files (png/jpg/gif/webp/bmp/ico/avif/apng — `diff/lib/imageDiff.ts`)
  skip line rows entirely for a GitHub-style picture diff: `read_image_versions` (Rust, mirrored by
  the dev middleware) serves both blobs as data URLs, and `ImageDiff` renders 2-up / swipe /
  onion-peel with pixel dimensions and byte sizes, mode persisted (`git-mapper:image-diff-mode`).
  Blobs load lazily: an IntersectionObserver (240px margin) gates each section's read until it
  nears the viewport — "all files" stacks every image section, and eager reads once hung the app;
  jsdom has no observer, so tests load immediately.
  The header totals every file in `all`
  scope and the selected file in `file` scope. Scope is persisted (`git-mapper:diff-scope`).
  A second toggle beside the scope switch lays the lines out: `Unified` (one stacked column, the
  default) or `Split` (old left, new right, GitHub-style — `splitDiffRows` in `gitDiffParser.ts`
  pairs the lines; the split body is ONE grid per file so the two panes' gutters share tracks).
  Layout is persisted (`git-mapper:diff-layout`).
  Long lines soft-wrap by default (the pane is narrow — GitHub's diffs scroll instead, but there
  they are full-width); a pressed wrap icon in the header switches to scrolling, persisted
  (`git-mapper:diff-wrap`). A split row whose other side has no line (add-only/delete-only) tints
  that void half with a neutral `bg-ink/[0.06]` wash so "came from empty" reads at a glance.
  Diff gutters are muted `text-ink/45` (GitHub's gray), clearly fainter than the code beside them.
- **The uncommitted diff is one side at a time, like VS Code.** A rail row click picks `staged`
  (HEAD→index) or `unstaged` (index→disk, untracked files included); `useWipSide` loads that side
  through `read_wip_side` (patches included) and falls back to the other side when the chosen one
  has no rows left. `DiffViewer`'s `hunkActions` puts Stage hunk + Discard (confirm) on the
  unstaged side and Unstage hunk on the staged side, via `HunkButtons.tsx`. `apply_hunk`
  (`git/hunks.rs`) rebuilds the patch from a fresh one-file diff, checks the hunk's `@@` header
  against what the UI showed (a moved hunk is refused, never misapplied) and pipes it to
  `git apply --recount` (`--cached`, `--reverse` or both). An untracked file is one all-added
  hunk, so its hunk verbs are the whole-file verbs. The combined `git diff HEAD` read behind the
  commit-list row and file totals is unchanged. The digest does NOT move when a hunk shifts
  between index and disk inside an already-`MM` file, hence `useWipSide.reload()` after every
  hunk action. The dev middleware mirrors both commands. Line-level: the `+`/`-` gutter cell of a changed line
  ticks it (`useLineSelection`, `diff/lib/lineSelection.ts`), and the hunk's buttons become Stage/Unstage/
  Discard N lines via `apply_hunk_lines` — `trim_hunk` cuts the fresh hunk to the picked lines (ordinals
  count only `+`/`-` lines; a skipped line turns into context or vanishes depending on direction) and
  `git apply --recount` does the rest. Only for files present on both sides (`modified`): a new or deleted
  file's patch header says create/delete, so those keep the whole-hunk verbs.
- `src/features/diff/components/FileList.tsx` — the changed-file sidebar. A List/Tree toggle (same segmented
  pattern as the diff-scope toggle) sits beside the counts; DetailsPanel owns the choice and
  persists it (`git-mapper:file-view`; `src/features/diff/lib/fileTree.ts` builds the tree). The tree renders
  one row per folder level (`data-file-dir`, folders start expanded, collapse survives while the
  same folder path returns) with the base name only — renames keep the `old → new` hint inline.
  Both shapes share `FileRow` and keep `data-file-item` on file rows, so the
  selection/`[data-file-item]` selectors behave identically in list and tree mode.
- Window focus re-checks the visible repo only (throttled to one probe per 1.5s, hidden
  windows skipped). Beyond the cheap probe, a focus fetches `--all --prune` once every
  3 minutes (`fetch_remote`), so ahead/behind and the tracking-refs pills speak for the
  network, not the last fetch — opening a repo (browse-in or saved-tab wake) fetches too. The
  fetch is silent on failure: offline is not an error worth a toast. Other tabs are not
  refreshed — they are off screen and each refresh costs git reads.
- **Pull/merge requests are the one provider-specific read, and they go through the provider's CLI:
  `gh` for GitHub, `glab` for GitLab.** `read_pull_requests` (`git/pulls.rs`, mirrored in
  `dev/gitApi/pulls.ts`) picks the CLI from the origin remote's host (`github`/`gitlab` in the
  name → that one only; any other host asks gh, then glab) and returns `{status, provider, raw}`.
  `cli-missing` / `cli-unauthenticated` / `unsupported-remote` are answers, not errors, so the menu
  explains them in place (unsupported hides the button). Classify "no remote of my kind" BEFORE
  "signed out": both CLIs end that message with a hint to `auth login`. `pull-requests/lib/pullRequests.ts` shapes
  each provider's JSON into the neutral `PullRequest` (`parsePullRequestPage(provider, raw, cursor)`;
  GitLab's `iid` is the number, its list carries no approvals, and the pipeline may be absent → no
  checks). **A read is one page of 30** (`PAGE_SIZE` in `pulls.rs`, `PR_PAGE_SIZE` in TS — keep them
  equal) for a scope, `open` or `all`, with a cursor: GitHub's `endCursor`, GitLab's page number.
  GitHub goes through ONE GraphQL query (`gh api graphql`), never `gh pr list --json`: that command's
  `statusCheckRollup` fetches every individual check of every PR and 504s on a busy repo
  (tauri-apps/tauri: ~12s then a gateway timeout), while the rollup's one-word `state` costs ~3s a
  page. The hook keeps three scopes — Open (read on arrival), Merged and All (each read when first
  shown) — as separate feeds; a follow-up page names the provider that answered the first, since a
  cursor means nothing to the other CLI. The button's count is GitHub's `totalCount`, not what has
  loaded. **Search is server-side, never a filter over loaded rows** (that would call a PR on page 40
  "not found"): the same read takes a `query`, GitHub switches to its `search` query
  (`repo:{owner}/{repo} is:pr is:open|is:merged <text>`, so GitHub's own qualifiers such as
  `author:x` work in the box) and GitLab adds `--search`. The hook holds the text per repo with its
  own result feeds, dropped when the text changes, and an answer for text that has since changed is
  discarded. Its state lives in a ref every write updates first: a mirror refreshed after render let
  the menu's effects read the previous query and skip the new one's read. The menu debounces typing
  (300ms) and the selected tab reads itself, because the tab and text outlive a repo switch.
  The glab adapter was written from GitLab's documented fields without a glab to probe — check a
  live `glab mr list --all --output json` before trusting a new field. A third provider is one more
  arm in `pulls.rs` + `pullRequests.ts`; the UI only reads `provider` for wording (`#13` vs `!13`,
  "Pull" vs "Merge request", "Open on GitHub|GitLab"). It is NOT part of load/refresh — it is a
  network call — so `pull-requests/hooks/usePullRequests.ts` owns it per repo path: re-read on a refs change and on
  focus (60s throttle), and automatic retries stop once the CLI is known missing/signed out (only the
  menu's Refresh retries). State is a drawn glyph (open / draft / merged / closed, `PullRequestStateIcon`)
  plus a tone from `pullRequestTone.ts`, never colour alone; only open speaks in colour, finished
  states stay neutral or violet so a long All list is not a rainbow. The pill chip is a
  surface-coloured capsule so it reads on any lane hue, filled pill included. Every option here is
  an enum (see [coding standards](coding-standards.md)): `PullScope`, `PullRequestsStatus`, `PullRequestProvider`,
  `PullRequestState`, `ChecksState`, `ReviewState` in `types.ts`, mirrored in Rust as `Scope`,
  `Status`, `Provider` with serde — a Rust test pins each wire spelling, so a rename on one side
  breaks the build — and GitHub's and GitLab's own spellings (`GitHubRollup`, `GitLabPipeline`, …)
  live beside the parsers that read them. **A squash or rebase
  merge leaves no trace of the branch in history**, so a commit on main finds its request by the hash
  the merge made (`mergeCommit`, from both providers) — and, for requests not loaded, by the number its
  own message names (`(#14)`, `Merge pull request #14`, GitLab's `See merge request g/p!7`), linked
  through the address of any loaded request; the text guess carries no state. The same
  `PullRequestChip` sits on commit rows and beside the hash in the details panel. Branch pills get a chip by name (`pullRequestForRef`; a local branch by
  name, a remote past `<remote>/`; fork PRs never match), and `PullRequestMenu` in the title bar
  lists them, read-only — a row opens the request in the browser. The popover is portaled to
  `<body>` because the title bar's backdrop blur would become the containing block of a fixed panel.
- `src/features/history/lib/graphGeometry.ts` — `ROW_HEIGHT` is shared between `CommitRow` and the SVG graph. Change both together or dots misalign with rows.
- `src/features/history/lib/commitFilter.ts` + `components/FindBar.tsx` — the find bar, VS Code style. Ctrl+F (a window listener in `App`, which owns `query`, `findOpen` and the active index) opens a floating glass bar over the top-right of the history list; the title bar only carries a pressed-state search button. `findMatches(commits, query)` returns the matching hashes in list order: space-separated tokens AND together, case-insensitive substring over hash, subject, body, author, email and ref-pill names (literal text — no fuzzy `_`/`-` folding); a blank query matches nothing. **Find highlights, it never filters**: non-matching rows dim (`data-dim`), the current match is tinted (`data-find-current`) and scrolled to centre, and the graph keeps every lane. Enter / Shift+Enter step (wrapping), Esc or the close button closes the bar and drops the dimming (the text is kept for the next open). Switching tabs closes and clears it. It covers ONLY the loaded window, so the bar states its scope (`N loaded`, shown while older history is unread, and on a miss) — a miss is not proof a commit does not exist. Paging stays on while it is open. Searching unloaded history (load more and keep searching) is a planned separate slice.
- `src/features/diff/lib/highlight.ts` — lazy highlight.js: the core is a dynamic import, and each grammar too (one small chunk per language, loaded the first time a diff of that type opens). `languageForPath` maps extension/basename → grammar, `loadHighlighter` + `highlightSync` produce ESCAPED token HTML (highlight.js escapes before wrapping — safe for dangerouslySetInnerHTML). The schemes are NOT highlight.js themes: index.css scopes palettes under `data-syntax` on the diff panel — `app` (design tokens, follows the theme), `github` and `neon` (literals with light/dark variants). The picker lives in settings, persisted as `git-mapper:syntax-scheme`, default `app` — there is no colour-off option.
- `src/shared/components/ContextMenu.tsx` — the right-click menu on commit rows and ref pills. Entries:
  `Check out <branch>` (only for a local branch that is not current), `Check out <remote>/<branch>…`
  (remote pills except `origin/HEAD`; double-clicking the pill does the same): opens
  `CheckoutRemoteDialog.tsx`, which asks for the local branch name (prefilled with the remote's own) and,
  when `local_branch_exists` says it is taken, offers `Check out existing & pull` or `Use another name`.
  `checkout_remote_branch` (`git/actions.rs`; no browser-tab mirror in `dev/gitApi`, it only runs in the desktop app) takes a typed
  `RemoteCheckoutMode`: `create` runs `checkout -b <name> --track <remote>/<branch>`, `existing` switches and
  runs `pull --ff-only <remote> <branch>` — a diverged branch stays checked out and the pull's error
  surfaces, so the app reloads after the call even on failure. `Create branch here…` (real history
  rows; `CreateBranchDialog.tsx`, name plus a "check out" box, a taken name is an inline error) runs
  `create_branch`, hash-gated like `checkout_commit`. `Delete branch <name>…` / `Delete remote branch
  <ref>…` (non-current local pills, remote pills) confirm through `ConfirmDialog` and run
  `delete_branch`: a local branch that is not an ancestor of HEAD or its upstream answers
  `DeleteOutcome.NotMerged` instead of deleting, and a second danger confirm re-runs it forced
  (merged-ness is decided with `merge-base --is-ancestor`, not by parsing `git branch -d`'s localised
  refusal); a remote delete is `push --delete`. `Create tag here…` (same rows; `CreateTagDialog.tsx`, name plus an
  "annotated" toggle that reveals a required message) runs `create_tag`: an empty message is a lightweight tag,
  anything else `tag -a -m`; a taken name is an inline error (`tag_exists`). Tag pills also offer `Push tag <name>`
  (`push_tag`, `push origin refs/tags/<name>`, no force), `Delete tag <name>…` (`delete_tag`, local only) and
  `Delete remote tag <name>…` (`delete_remote_tag`, `push origin --delete`); both deletes confirm first. `Check out commit <hash>…`
  (real history rows only — not the HEAD row, the `wip` row or a stash row; it opens
  `ConfirmDialog.tsx`, because checking out a commit detaches HEAD and commits made there are
  lost without a branch — the command is `checkout_commit`, hash-format-gated, `--detach`),
  `Create pull request…` (branch and remote pills; a remote pill passes the bare branch name):
  `read_pull_request_url` (`git/pulls.rs`, mirrored in `dev/gitApi/pulls.ts`) builds GitHub's
  compare page or GitLab's new-merge-request page from the origin URL — no CLI, no network — and
  the app opens it in the browser; any other host gets a notice. The branch must already be pushed.
  `Copy commit hash` and `Copy branch|remote|tag|stash name`; a copy flips that entry to "Copied!"
  for 700ms, then the menu closes. A stash row additionally offers `Apply stash` (no confirm —
  git refuses an apply that would conflict and keeps the entry) plus `Pop stash…` / `Drop stash…`
  (red danger confirm via `ConfirmDialog`; the command is `stash_action` with a typed index and
  verb whitelist). The checked-out tip offers `Undo commit …` when the repo is ahead and the tip
  is a plain (non-merge) commit — `undo_commit`, a soft reset that returns the tip's files
  staged, behind a plain (non-danger) confirm. Dismisses on outside pointerdown, Escape, scroll (capture) and
  resize. Clipboard goes through `src/shared/lib/clipboard.ts` `copyText`, which falls back to a hidden
  textarea because WebView2 can deny the async clipboard API per-origin.
- `src/shared/lib/ui.ts` — `PANEL` and `GLASS_CONTROL` class strings; every panel/button picks these up.
- `src/features/history/lib/tableLayout.ts` — column widths, grid templates, resize min/max.
- `src/shared/lib/persisted.ts` — `usePersistedState` (localStorage-backed `useState`) and the `STORAGE_KEYS`
  registry every key goes through. Launch restores: open repo paths, the active tab, the selected
  commit and file per repo, the diff pane scope, and the details panel open/height. Window bounds come from
  `tauri-plugin-window-state` (Rust side, `window-state:default` capability), not from localStorage.
- `src/features/shell/theme.ts` + inline script in `index.html` — theme resolution; storage key `git-mapper:theme`; the head script must stay in sync with that key.
- `src/index.css` — all design tokens (`@theme` block + `.dark` overrides) and the background aurora (`body::before`).
