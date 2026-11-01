# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Tauri 2 desktop shell — an undecorated WebView2 window with a custom title bar — shipping Windows, macOS and Linux. Web design language, not native-styled.)

## Users

Primary: solo developers who own their working copy locally and reach for a lightweight, beautiful way to read Git history instead of heavyweight clients (Fork, GitHub Desktop, GitKraken) or raw `git log`. Situation: a repo is already open locally; the job is understanding history — what happened, which line belongs to which branch, what changed and in what file.

Secondary (confirmed future direction, today's users plus): the same developers once committing and possibly PR review are added.

## Product Purpose

Git Mapper is a standalone desktop Git history viewer. It reads real repositories through the `git` CLI (Tauri backend returns porcelain output; TS parsers shape it) and presents a frosted-glass commit feed: commit graph, branch/remote/tag pills, changed-file list, and a syntax-highlighted, unified/split, image-capable diff. Success means a look at the graph answers "what happened here" faster than the terminal, and the design is worth having on screen.

## Positioning

Lightweight zero-config viewer that runs real `git` for its data but looks like a designed product (frosted-glass feed, lane-coloured graph) — a category neighbor could copy the git plumbing or the glass, not the pairing. Read-only today is a milestone, not a claim: committing is planned next, so copy and IA must not hard-wire "we never touch your repo."

## Operating Context

- Developers on Windows (fajarwz's machine), some repos on `\\wsl.localhost` mounts where `git status` over 9P can take ~20s — the app must stay responsive while git grinds.
- Distributed as installers via GitHub Releases with an auto-updater feed (`latest.json`); macOS builds are signed but not notarized.
- Repos open as persistable tabs; state (theme, layout, panel) survives restarts.

## Capabilities and Constraints

- Reads: 500-commit pages (scroll to load more), refs, status, per-commit changed files + patches, image blobs for picture diffs.
- Mutating: only `checkout_branch` (double-click a branch pill) and `checkout_commit` (detached HEAD behind a confirm dialog). No staging or committing yet — **roadmap**: committing is planned; PR review is a plausible future direction.
- Search filters only the loaded 500-commit window (Ctrl+F); deep search over full history is a separate planned slice.
- Stash rows are viewed/applied/popped/dropped; history rows offer copy, checkout and stash actions via context menu.
- Light/dark glass themes; window bounds live outside localStorage (window-state plugin).
- Technical constraints carried in AGENTS.md: WebView2 must never reload the page; git reads are async and parallelized; files/diffs load lazily per commit; worktree digest drives surgical refresh.

## Brand Commitments

- Name: **Git Mapper** (crate `git_mapper_lib`, id `com.fajarwz.git-mapper`).
- Logo: `docs/logo.svg`; app icon regenerates from `src-tauri/icons/app-icon.svg` and must stay in sync with the title-bar BrandMark.
- Aesthetic: frosted-glass commit feed, violet/rose/warm palette — and the full design-system rules in **AGENTS.md** (tokens only, custom shadow utilities, pill language, chrome backing) are binding. No further explicit commitments.

## Evidence on Hand

- `docs/screenshots/*` (main light/dark, split light/dark) and README copy — real, current.
- GitHub Releases download counts (badges in README); `bench_results.log` for performance notes.
- No testimonials, press, or case studies — do not fabricate any.

## Product Principles

1. **Real git, rendered well** — porcelain truth through the CLI, then design does the comprehension work (graph enclosure, pill language, surgical refresh).
2. **Responsive while git grinds** — a slow WSL mount is a normal input, never a frozen window.
3. **Lightweight by feel, not by absence** — small and fast now, growing into committing without re-architecting.
4. **The glass look is the brand** — design craft is a product feature users download it for, not chrome around a viewer.

## Accessibility & Inclusion

Windows keyboard operation is expected: tabs stay activatable via keyboard (dnd sensors are pointer-only for this reason), Ctrl+F/Ctrl+R paths behave, and confirm dialogs use real buttons. Contrast targets from the design rules (AA on the danger confirm; no unreadable chrome on the aurora). No other product-specific standard established.
