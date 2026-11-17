# Project

**Git Mapper** — standalone Git history viewer for Windows. Tauri 2 + React 19 + TypeScript + Tailwind CSS v4 + Vite. Reads real Git data: the Tauri backend runs the `git` CLI and returns porcelain output; TS parsers turn it into `types.ts` shapes. Writes go through the staging rail (stage/unstage/discard, commit, undo tip), stash actions, fetch/pull (`--ff-only`)/push, and in-app merge with a conflict resolver (`merge_branch` + `resolve_conflicts` ours/theirs + `abort_merge`/`complete_merge` in `git/merge.rs`, with `read_conflict_files` serving the rail's Conflicts section—the file on disk with its markers for the inline block view, plus each side's patch against stage 1 to tell a deletion from a binary file; `write_conflict_resolution` saves a block choice and stages the file once no marker is left); apart from those scoped verbs, access is read-only.

- Package/crate/identifier/brand are `git-mapper` / `git_mapper_lib` / `com.fajarwz.git-mapper` / "Git Mapper".
