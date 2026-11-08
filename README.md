<div align="center">

<img src="docs/logo.svg" alt="Git Mapper logo" width="96">

# Git Mapper

**Every branch, crystal clear.**

A fast, lightweight Git history viewer for the desktop. Open a repository and follow the graph,
diffs and stashes on a clean pane — no account, no setup.

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

## What it does

- Opens repositories as tabs. Each tab remembers its selected commit, file and panel state, and
  tabs can be dragged into any order.
- Commit list with a graph whose lines keep their colour from tip to root, and branch,
  remote and tag pills. Double-click a branch
  pill to check it out.
- Details panel with commit metadata and the changed-file list — flat or folder tree, with status
  badges — and a line-numbered diff with lazy syntax highlighting. Image files get a picture diff
  (2-up, swipe, onion peel) instead of a text diff.
- Diff layout: unified or split (old lines left, new lines right, like GitHub). The empty side of
  an added or deleted line carries a tinted void so it reads as coming from nothing, and long
  lines soft-wrap by default with a toggle to scroll instead.
- An `Uncommitted changes` row on top while the working tree is dirty: staged, unstaged and
  untracked files, diffed against `HEAD`.
- A staging rail for that dirty tree: stage, unstage and discard by file, type the message and
  commit without leaving the window. The toolbar fetches the remotes and pulls or pushes the
  checked-out branch.
- Merging a local branch from its pill's menu. A conflict lands in the rail: keep the current
  or the incoming version per file, or open it to see the file with its conflict blocks inline
  (line numbers, syntax colours) and choose current, incoming or both for each block. Finish
  with git's own prepared message, or abort the merge entirely.
- Refresh on window focus (only the commits that are new get read) or from the toolbar button.
  Rows a refresh touched flash amber.
- Light and dark glass themes, remembered across restarts together with the window size and
  position.
- Resizable graph gutter, commit / author / date columns and details panel height.
- Search over the loaded history: hashes, commit messages, authors and ref pills. Ctrl+F focuses
  the title-bar box, Esc clears.

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

## Support

Git Mapper is free and GPL, and it stays free. If it saves you time, you can
[sponsor the project on GitHub](https://github.com/sponsors/fajarwz). Nothing in the app is locked
behind it, and the best thing you can give me instead is a good bug report.

Contributions are welcome, and [CONTRIBUTING.md](CONTRIBUTING.md) says how: I read every issue and
pull request myself.

## License

[GNU General Public License v3.0 or later](LICENSE). Copyright © 2026 Fajar Windhu Zulfikar.
