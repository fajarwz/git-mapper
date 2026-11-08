// Dev-server mirror of src-tauri/src/git/actions.rs (browser tabs have no Tauri backend).
import { type Handlers, run } from "./git.ts";

export const actionsHandlers: Handlers = {
  checkout_branch: ({ dir, branch }) => {
    run(String(dir), ["checkout", String(branch)]);
    return null;
  },
  checkout_commit: ({ dir, hash }) => {
    const h = String(hash).trim();
    if (h.length < 4 || h.length > 40 || !/^[0-9a-fA-F]+$/.test(h)) {
      throw new Error(`"${h}" is not a commit hash`);
    }
    run(String(dir), ["checkout", "--detach", h]);
    return null;
  },
  stash_action: ({ dir, index, action }) => {
    const verb = String(action);
    if (verb !== "apply" && verb !== "pop" && verb !== "drop") {
      throw new Error(`"${verb}" is not a stash action`);
    }
    const n = Math.trunc(Number(index));
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`"${index}" is not a stash position`);
    }
    run(String(dir), ["stash", verb, `stash@{${n}}`]);
    return null;
  },
  fetch_remote: ({ dir }) => {
    const remotes = String(run(String(dir), ["remote"])).trim();
    if (!remotes) return null;
    run(String(dir), ["fetch", "--all", "--prune", "--quiet"]);
    return null;
  },
  pull_branch: ({ dir }) =>
    run(String(dir), ["pull", "--ff-only", "--no-edit"]),
  push_branch: ({ dir }) =>
    run(String(dir), ["push", "-u", "origin", "HEAD"]),
};
