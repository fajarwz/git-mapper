<div align="center">

<img src="docs/logo.svg" alt="Git Mapper logo" width="96">

# Git Mapper

**Every branch, crystal clear.**

A fast, lightweight Git history viewer for the desktop. Open a repository and follow the graph,
diffs and stashes on a clean pane — no account, no setup.

**[gitmapper.fajarwz.com](https://gitmapper.fajarwz.com)**

[![Release](https://img.shields.io/github/v/release/fajarwz/git-mapper?logo=github&labelColor=17151f&color=6e56cf)](https://github.com/fajarwz/git-mapper/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/fajarwz/git-mapper/total?labelColor=17151f&color=6e56cf&logo=github)](https://github.com/fajarwz/git-mapper/releases)
[![Sponsor](https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?labelColor=17151f&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/fajarwz)
[![License: GPL v3](https://img.shields.io/badge/license-GPL--3.0--or--later-6e56cf.svg?labelColor=17151f&logo=gnu&logoColor=white)](LICENSE)

[![Tests](https://img.shields.io/github/actions/workflow/status/fajarwz/git-mapper/ci.yml?label=tests&logo=vitest&logoColor=white&labelColor=17151f)](https://github.com/fajarwz/git-mapper/actions/workflows/ci.yml)
[![Release build](https://img.shields.io/github/actions/workflow/status/fajarwz/git-mapper/release.yml?label=Release%20build&logo=tauri&logoColor=24C8DB&labelColor=17151f)](https://github.com/fajarwz/git-mapper/actions/workflows/release.yml)

![Windows](https://img.shields.io/badge/Windows-0078D6?labelColor=17151f&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZmlsbD0iI2ZmZmZmZiIgZD0iTTMgM2g4LjR2OC40SDNWM3ptOS42IDBIMjF2OC40aC04LjRWM3pNMyAxMi42aDguNFYyMUgzdi04LjR6bTkuNiAwSDIxVjIxaC04LjR2LTguNHoiLz48L3N2Zz4%3D)
![macOS](https://img.shields.io/badge/macOS-A2AAAD?labelColor=17151f&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-FCC624?labelColor=17151f&logo=linux&logoColor=white)

![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?labelColor=17151f&logo=tauri&logoColor=24C8DB)
![React](https://img.shields.io/badge/React-19-61DAFB?labelColor=17151f&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?labelColor=17151f&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?labelColor=17151f&logo=tailwindcss&logoColor=06B6D4)

</div>

## Download

Grab the latest installer from [the releases page](https://github.com/fajarwz/git-mapper/releases/latest):

| OS | Download |
| --- | --- |
| Windows | [`Git.Mapper_x64-setup.exe`](https://github.com/fajarwz/git-mapper/releases/latest/download/Git.Mapper_x64-setup.exe) (Unsigned installer. If SmartScreen appears, click More info, then Run anyway) |
| macOS | [`Git.Mapper.dmg`](https://github.com/fajarwz/git-mapper/releases/latest/download/Git.Mapper.dmg) (Apple Silicon + Intel. The app isn't notarized — right-click the app and pick **Open** to run it) |
| Linux | [`Git.Mapper_amd64.AppImage`](https://github.com/fajarwz/git-mapper/releases/latest/download/Git.Mapper_amd64.AppImage) (runs without installing) |

The links above always resolve to the newest release.

<img src="docs/screenshot.png" alt="Commit list, light theme" width="100%">

## Features

**Read history**

<img src="website/public/screens/graph.png" alt="The commit graph in lane colours with branch, tag and stash pills" width="70%">

- **Lane-coloured graph.** Every branch keeps its colour from tip to root, forks and merges bend at
  their own commit, and branch, remote and tag pills sit on the rows. Resize the graph gutter,
  or drag it wider on lane-heavy histories.
- **Repository tabs.** Each tab remembers its selected commit, file and panel state; drag tabs
  into any order. Tabs you leave alone go to sleep to save memory and wake on click.
- **Search.** Filter the loaded history by hash, message, author or ref name. Ctrl+F focuses the
  title-bar box, Esc clears.
- **Your columns, your way.** Resize the commit / author / date columns, drag their headers to
  reorder them, right-click a header to hide one.
- **Stashes as rows.** Each stash sits above the commit it was taken on. Apply, pop or drop from
  its menu (pop and drop ask first).
- **Avatars.** Initials chips by default, Gravatar photos if you like (settings toggle).

**Read changes**

<img src="website/public/screens/split.png" alt="A commit with its split diff open" width="100%">

- **Diffs that read.** Line-numbered, syntax-highlighted (lazy per language, three colour
  schemes), with word-level change marks. Unified or split layout, soft-wrap or scroll.
- **One file or all of them.** Show the selected file alone, or stack every changed file in one
  scroll with sticky headers and a jump list.
- **Flat list or folder tree** for changed files, with status badges and rename hints.
- **Picture diffs** for images: 2-up, swipe or onion peel, with pixel sizes and byte counts.
- **Snappy.** Hover a file to prefetch its patch; clicking shows a skeleton while it loads.

**Change things**

<img src="website/public/screens/stage.png" alt="The staging rail beside the staged diff" width="100%">

<img src="website/public/screens/hunk.png" alt="Picking single lines of a hunk to stage, unstage or discard" width="100%">

<img src="website/public/screens/conflict.png" alt="Resolving a merge conflict block by block, inline" width="100%">

- **Stage, commit, undo.** The `Uncommitted changes` row opens a staging rail: stage, unstage or
  discard by file, write the message and commit without leaving the window. Undo the tip commit
  and its files come back staged. The rail docks itself when the tree goes clean.
- **Hunks and single lines.** Stage, unstage or discard one hunk, or tick individual `+`/`-`
  lines and act on just those. Staged and unstaged sides are shown one at a time, like VS Code.
- **Sync.** Fetch, pull (fast-forward only) and push the checked-out branch from the counters
  beside its name.
- **Checkout.** Double-click a branch pill, or right-click for branch and commit checkout
  (detaching HEAD asks first).
- **Merge and resolve.** Merge a local branch from its pill's menu. Conflicts land in the rail:
  take current or incoming per file, or open the file with its conflict blocks inline and choose
  current, incoming or both per block. Finish with git's own message, or abort.
- **Copy** hashes and branch, remote, tag and stash names from the right-click menu.

**Stays out of your way**

- **Always current.** Refresh on window focus (only new commits get read), a periodic background
  fetch so ahead/behind counts are honest, or the toolbar button. Rows a refresh touched flash.
- **Light and dark glass themes**, zoom the whole window with Ctrl/Cmd plus, minus and zero, and
  window size and position restored on launch.
- **Updates itself.** Checks on launch, downloads in the background, restarts when you say so.
- **Local and private.** No account, no telemetry in the app; it runs your own `git`.

## Run it

```bash
npm install
npm run dev        # browser at http://localhost:1420
npm run tauri dev  # desktop window (compiles the Rust side)
```

```bash
npm run build      # tsc && vite build
npm run lint       # Tailwind class hygiene
npm run tauri build
```

Git has to be on `PATH`.

## How it works

The Rust side (`src-tauri/src/git.rs`) runs `git` and returns its porcelain output; the parsers in
`src/lib/` turn that text into the types in `src/types.ts`. Every backend call goes through
`src/data/gitLoader.ts`, so components never invoke the backend themselves. `npm run dev` serves
the same commands at `POST /api/git`, which is why the app also runs in a plain browser.

## Not there yet

- Searching history beyond the loaded 500-commit window.
- Rebasing and cherry-picking.
- Pull requests (a `gh` passthrough is the planned next slice).

## Support

Git Mapper is free and GPL, and it stays free. If it saves you time, you can
[sponsor the project on GitHub](https://github.com/sponsors/fajarwz). Nothing in the app is locked
behind it, and the best thing you can give me instead is a good bug report.

Contributions are welcome, and [CONTRIBUTING.md](CONTRIBUTING.md) says how: I read every issue and
pull request myself.

## License

[GNU General Public License v3.0 or later](LICENSE). Copyright © 2026 Fajar Windhu Zulfikar.
