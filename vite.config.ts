import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
// @ts-expect-error type error without @types/node package
import path from "node:path";
import { execFileSync } from "node:child_process";
const host = process.env.TAURI_DEV_HOST;

/** FNV-1a: the stamps below are only compared for equality between two reads. */
function digest(text: string): string {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash ^ text.charCodeAt(index)) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${hash.toString(16)}:${text.length}`;
}

/** Mirrors worktree_stamp in src-tauri/src/git.rs: status list + tracked patch + untracked stats. */
function worktreeStamp(dir: string, statusOut: string, changed: number): string {
  let stamp = statusOut;
  if (changed === 0) return digest(stamp);
  try {
    stamp += execFileSync("git", ["diff", "--no-color", "HEAD"], { cwd: dir, encoding: "utf8" });
  } catch {
    // Unborn branch: no HEAD to diff against; the status list alone has to do.
  }
  for (const line of statusOut.split("\n")) {
    if (!line.startsWith("?? ")) continue;
    const file = line.slice(3);
    try {
      const meta = fs.statSync(path.join(dir, file));
      stamp += `\u0001${file}:${meta.size}:${meta.mtimeMs}`;
    } catch {
      // Vanished between the status read and here.
    }
  }
  return digest(stamp);
}

/** Mirrors untracked_entry in src-tauri/src/git.rs: `git diff` never lists untracked paths. */
function untrackedEntry(
  dir: string,
  file: string,
): { numstat: string; nameStatus: string; patch: string } {
  const header = `diff --git a/${file} b/${file}\nnew file mode 100644\n`;
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(dir, file));
  } catch {
    bytes = Buffer.alloc(0);
  }
  const binary = bytes.length > 2 * 1024 * 1024 || bytes.includes(0);
  if (binary) {
    return {
      numstat: `-\t-\t${file}\n`,
      nameStatus: `A\t${file}\n`,
      patch: `${header}--- /dev/null\n+++ b/${file}\n@@ Binary file, not shown @@\n`,
    };
  }
  const lines = bytes.toString("utf8").split("\n");
  // A trailing newline does not invent an extra line.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) {
    return { numstat: `0\t0\t${file}\n`, nameStatus: `A\t${file}\n`, patch: header };
  }
  const cr = String.fromCharCode(13);
  const body = lines.map((line) => `+${line.endsWith(cr) ? line.slice(0, -1) : line}
`).join("");
  return {
    numstat: `${lines.length}\t0\t${file}\n`,
    nameStatus: `A\t${file}\n`,
    patch: `${header}--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${body}`,
  };
}

// Browser-tab fallback for the Git plumbing: same command names as
// src-tauri/src/git.rs, run directly by the dev server. Dev-only.
function gitDevApi(): Plugin {
  const run = (dir: string, args: string[]): string =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    open_repository: ({ dir }) => {
      if (run(String(dir), ["rev-parse", "--is-inside-work-tree"]).trim() !== "true") {
        throw new Error(`${dir} is not a Git repository`);
      }
      const path = run(String(dir), ["rev-parse", "--show-toplevel"]).trim();
      return { path, name: path.split(/[\\/]/).pop() ?? path };
    },
    read_status: ({ dir }) => {
      const out = run(String(dir), ["status", "-sb", "--untracked-files=all"]);
      const line = out.split("\n").find((l) => l.startsWith("## ")) ?? "";
      const head = line.slice(3).trim();
      const [branchPart, tail] = head.split("...");
      let ahead = 0;
      let behind = 0;
      for (const m of (tail ?? "").matchAll(/(ahead|behind) (\d+)/g)) {
        if (m[1] === "ahead") ahead = Number(m[2]);
        else behind = Number(m[2]);
      }
      const changed = out
        .split("\n")
        .filter((l) => l.trim() !== "" && !l.startsWith("## ")).length;
      let headSha = "";
      try {
        headSha = run(String(dir), ["rev-parse", "--verify", "HEAD"]).trim();
      } catch {
        headSha = "";
      }
      return {
        branch: branchPart ?? "HEAD detached",
        ahead,
        behind,
        dirty: changed > 0,
        changed,
        head: headSha,
        worktree: worktreeStamp(String(dir), out, changed),
      };
    },
    read_log: ({ dir, limit, skip }) => ({
      text: run(
        String(dir),
        ["log", "--all", "--date-order", `--max-count=${Number(limit) || 500}`, `--skip=${Number(skip) || 0}`, "--date=iso-strict",
          "--pretty=tformat:%d%x00%H%x00%an%x00%ae%x00%aI%x00%P%x00%B%x1e"],
      ),
    }),
    read_log_order: ({ dir, limit }) => ({
      text: run(String(dir), [
        "log",
        "--all", "--date-order",
        `--max-count=${Number(limit) || 500}`,
        "--date=iso-strict",
        "--pretty=tformat:%H",
      ]),
    }),
    read_log_delta: ({ dir, since, limit }) => {
      const rev = String(since ?? "").trim();
      const base = ["log", "--all", "--date-order", `--max-count=${Number(limit) || 500}`];
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
    checkout_branch: ({ dir, branch }) => {
      run(String(dir), ["checkout", String(branch)]);
      return null;
    },
    read_commit_files: ({ dir, hash }) => {
      const h = String(hash);
      if (h === "wip") {
        const safe = (args: string[]) => {
          try {
            return run(String(dir), args);
          } catch {
            return "";
          }
        };
        let numstat = safe(["diff", "--numstat", "--no-color", "HEAD"]);
        let name_status = safe(["diff", "--name-status", "--no-color", "HEAD"]);
        let diff = safe(["diff", "--no-color", "HEAD"]);
        // Untracked files are invisible to `git diff`; add them the way git prints a new file.
        for (const file of safe(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")) {
          if (!file) continue;
          const entry = untrackedEntry(String(dir), file);
          numstat += entry.numstat;
          name_status += entry.nameStatus;
          diff += entry.patch;
        }
        return { numstat, name_status, diff };
      }
      let isRoot = false;
      try {
        execFileSync("git", ["rev-parse", "--verify", `${h}^1`], { cwd: String(dir), encoding: "utf8" });
      } catch {
        isRoot = true;
      }
      const base = isRoot
        ? ["show", "--root", "--format=", "--no-color", h]
        : ["diff", "--no-color", `${h}^1`, h];
      const runVariant = (flag: string) =>
        // Flag position matters: `--numstat` must come after the sub-command (show/diff).
        run(String(dir), flag ? [base[0], flag, ...base.slice(1)] : base);
      return {
        numstat: runVariant("--numstat"),
        name_status: runVariant("--name-status"),
        diff: runVariant(""),
      };
    },
  };

  return {
    name: "git-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/git", (req, res) => {
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
              op: string;
              args: Record<string, unknown>;
            };
            const handler = handlers[body.op];
            if (!handler) throw new Error(`unknown op ${body.op}`);
            const result = handler(body.args ?? {});
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result ?? null));
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        })();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), svgr(), gitDevApi()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
