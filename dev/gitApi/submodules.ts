// Dev-server mirror of src-tauri/src/git/submodules.rs.
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
// @ts-expect-error type error without @types/node package
import path from "node:path";
import { type Handlers, run } from "./git.ts";

const STATES: Record<string, string> = { "-": "uninitialized", "+": "moved", U: "conflict", " ": "ok" };

export const submodulesHandlers: Handlers = {
  read_submodules: ({ dir }) => {
    if (!fs.existsSync(path.join(String(dir), ".gitmodules"))) return [];
    const out: Array<{ path: string; state: string; commit: string }> = [];
    for (const line of run(String(dir), ["submodule", "status"]).split("\n")) {
      const state = STATES[line.charAt(0)];
      const cut = line.indexOf(" ", 1);
      if (!state || cut === -1) continue;
      const rest = line.slice(cut + 1);
      const describe = rest.lastIndexOf(" (");
      out.push({
        path: (describe !== -1 && rest.endsWith(")") ? rest.slice(0, describe) : rest).trimEnd(),
        state,
        commit: line.slice(1, cut),
      });
    }
    return out;
  },
};
