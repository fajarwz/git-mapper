// Dev-server mirror of src-tauri/src/git/log.rs (browser tabs have no Tauri backend).
import { type Handlers, run } from "./git.ts";

export const logHandlers: Handlers = {
  read_log: ({ dir, limit, skip }) => ({
    text: run(
      String(dir),
      ["log", "--exclude=refs/stash", "--all", "--date-order", `--max-count=${Number(limit) || 500}`, `--skip=${Number(skip) || 0}`, "--date=iso-strict",
        "--pretty=tformat:%d%x00%H%x00%an%x00%ae%x00%aI%x00%P%x00%B%x1e"],
    ),
  }),
  read_log_order: ({ dir, limit }) => ({
    text: run(String(dir), [
      "log",
      "--exclude=refs/stash", "--all", "--date-order",
      `--max-count=${Number(limit) || 500}`,
      "--date=iso-strict",
      "--pretty=tformat:%H",
    ]),
  }),
  read_log_delta: ({ dir, since, limit }) => {
    const rev = String(since ?? "").trim();
    const base = [
      "log",
      "--exclude=refs/stash", "--all", "--date-order",
      `--max-count=${Number(limit) || 500}`,
    ];
    if (rev !== "") base.push(`^${rev}`);
    base.push("--date=iso-strict", "--pretty=tformat:%d%x00%H%x00%an%x00%ae%x00%aI%x00%P%x00%B%x1e");
    return { text: run(String(dir), base) };
  },
  read_refs: ({ dir }) => ({
    text: run(String(dir), [
      "for-each-ref",
      "--format=%(objectname)%09%(refname)",
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ]),
  }),
  read_stashes: ({ dir }) => ({
    text: run(String(dir), [
      "stash",
      "list",
      "--pretty=tformat:%gd%x00%H%x00%P%x00%an%x00%ae%x00%cI%x00%gs%x1e",
    ]),
  }),
};
