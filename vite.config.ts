import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
import { execFileSync } from "node:child_process";
const host = process.env.TAURI_DEV_HOST;

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
      };
    },
    read_log: ({ dir, limit, skip }) => ({
      text: run(
        String(dir),
        ["log", "--all", `--max-count=${Number(limit) || 500}`, `--skip=${Number(skip) || 0}`, "--date=iso-strict",
          "--pretty=tformat:%d%x00%H%x00%an%x00%ae%x00%aI%x00%P%x00%B%x1e"],
      ),
    }),
    read_log_delta: ({ dir, since, limit }) => {
      const rev = String(since ?? "").trim();
      const base = ["log", "--all", `--max-count=${Number(limit) || 500}`];
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
        return {
          numstat: run(String(dir), ["diff", "--numstat", "--no-color", "HEAD"]),
          name_status: run(String(dir), ["diff", "--name-status", "--no-color", "HEAD"]),
          diff: run(String(dir), ["diff", "--no-color", "HEAD"]),
        };
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
  plugins: [react(), tailwindcss(), gitDevApi()],

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
