import type { Plugin } from "vite";
import { statusHandlers } from "./status.ts";
import { logHandlers } from "./log.ts";
import { actionsHandlers } from "./actions.ts";
import { mergeHandlers } from "./merge.ts";
import { hunksHandlers } from "./hunks.ts";
import { stagingHandlers } from "./staging.ts";
import { filesHandlers } from "./files.ts";
import type { Handlers } from "./git.ts";

const handlers: Handlers = {
  ...statusHandlers,
  ...logHandlers,
  ...actionsHandlers,
  ...mergeHandlers,
  ...hunksHandlers,
  ...stagingHandlers,
  ...filesHandlers,
};

// Browser-tab fallback for the Git plumbing: same command names as the Tauri commands in
// src-tauri/src/git/, run directly by the dev server. Dev-only; one file per Rust module.
export function gitDevApi(): Plugin {
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
