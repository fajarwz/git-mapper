# Contributing to Git Mapper

Thanks for being here. Git Mapper is a small desktop app I build and maintain in my spare time,
and I read every issue and every pull request that comes in. Nothing gets triaged by a bot and
nothing gets ignored on purpose. A typo fix, a screenshot of a row that looks off, a bug report
with three lines of detail: all of it is welcome and all of it helps.

This page stays short on purpose. How to report something, how to build the app, and what a
pull request that is easy to merge looks like here.

## Ways to help

- **Report a bug.** The report itself is the contribution. Even if you cannot fix it, a precise
  description is what the fix starts from.
- **Suggest a feature.** Tell me what you are trying to do, not only the button you want. The
  problem behind the request usually has a better solution than the one we would guess.
- **Send a pull request.** Small ones land fastest. See the gates below.
- **Improve the docs.** If a step in the README did not work on your machine, that is a doc bug
  and worth an issue.
- **Share it.** Someone with a 400-branch repo and a slow history is exactly who this is for.

## Reporting a bug

Open an [issue](https://github.com/fajarwz/git-mapper/issues/new) with:

- what you did, what happened, and what you expected instead
- your OS and the app version (the settings dialog shows it)
- the output of `git --version`
- a screenshot if it is visual, the graph and the diff are easiest to describe with one
- the repository's shape if you can share it: roughly how many commits, branches and worktrees

If the graph looks wrong, the first 20 lines of `git log --graph --oneline --all` at that point
tell me more than a paragraph of description. If the repository is private, paste the shape and
the branch names only, not the code.

## Suggesting a feature

Open an issue and describe the situation first. "I scroll 12k commits and lose the branch I was
following" says more than "add a filter". Ideas that make history easier to read win over ideas
that add a mode. The honest gaps are listed at the bottom of the README, and the roadmap at the
bottom of `AGENTS.md` shows what is already planned.

## Setting up

You need:

- **Node 20 or newer**
- **Rust stable** ([rustup](https://rustup.rs))
- **Git on `PATH`** (the app runs the real `git` CLI, it does not bundle it)
- **Windows:** WebView2, already present on Windows 10 and 11, plus the C++ build tools so the
  Rust side can compile. The [Tauri prerequisites](https://tauri.app/start/prerequisites/) page
  covers both, whatever your OS.

Then:

```bash
npm install
npm run tauri dev   # the real desktop window
```

For frontend work you can skip Rust entirely and use `npm run dev`, which serves the same
commands in a plain browser at http://localhost:1420. TypeScript hot-reloads. Rust changes
recompile and restart the window on their own, slowly the first time.

## Before you open a pull request

Run the same four checks CI runs on every push:

```bash
npm run lint:check          # Tailwind class hygiene
npm run build               # tsc && vite build
npm test                    # vitest
cd src-tauri && cargo test  # git commands against throwaway repos
```

If one fails on your machine but passes in CI, say so in the PR instead of hiding it. That is a
useful bug on its own.

## Where things live

- `src/App.tsx` is the shell. Per-domain state lives in `src/hooks/`, pure logic in `src/lib/`.
- `src-tauri/src/git/` holds the commands that run git. One module per domain.
- `src/data/gitLoader.ts` is the only place that calls the backend. Components never invoke.
- `AGENTS.md` is the full map: architecture per file, conventions, known pitfalls.

## House style

- **Tokens, not hex.** Colours come from `src/index.css`. Panels and buttons use `PANEL` and
  `GLASS_CONTROL` from `src/lib/ui.ts`.
- **Small files.** A file past ~300 lines, or one mixing two domains, splits when you touch it.
- **Tests live beside the code** (`foo.ts` and `foo.test.ts` in the same folder), and anything
  that parses git output gets one.
- **Comments are rare.** Only for what the code cannot say: a git quirk, a non-obvious reason.
- **Match the surroundings.** Same class strings, same naming, same shape as the file next door.

## Commits and pull requests

- Use a conventional prefix: `fix:`, `feat:`, `docs:`, `refactor:`, `chore:`. The subject is
  imperative, the body says why.
- One change per PR. A refactor on top of a bug fix is hard to review in a spare evening, even
  when both are good.
- Explain the motivation in the PR description before explaining the code. What breaks today,
  what this changes, how you checked it.
- Screenshots for anything visual. Before and after is perfect.
- A new dependency deserves an issue first. The app is download-and-run, so weight matters.
- Please do not reformat files you are not otherwise touching, and do not bump versions in a
  feature PR. Releases are cut separately.

## Review

I am one person with a day job, so give me a few days. If a PR or issue sits unanswered for more
than a week, a single comment bump is welcome and not annoying at all. Small, focused PRs land
fastest. If your direction is one I am unsure about, I will tell you early instead of letting the
work rot.

## License

Git Mapper is licensed under the [GNU General Public License v3.0 or later](LICENSE). By sending a
pull request you agree your contribution ships under the same license.

## Thank you

You do not owe me anything here. Using the app, filing an honest bug report, or
[sponsoring the project on GitHub](https://github.com/sponsors/fajarwz) are each a real way to
keep this going.
