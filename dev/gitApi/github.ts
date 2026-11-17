// Dev-server mirror of src-tauri/src/git/github.rs.
// @ts-expect-error type error without @types/node package
import { spawnSync } from "node:child_process";
import type { Handlers } from "./git.ts";

const FIELDS =
  "number,title,state,isDraft,author,headRefName,baseRefName,isCrossRepository,url,updatedAt,reviewDecision,statusCheckRollup";

function classify(stderr: string): string | null {
  const text = stderr.toLowerCase();
  if (
    text.includes("gh auth login") ||
    text.includes("not logged in") ||
    text.includes("authentication") ||
    text.includes("http 401")
  ) {
    return "gh-unauthenticated";
  }
  if (
    text.includes("none of the git remotes") ||
    text.includes("no github remotes") ||
    text.includes("could not determine base repo") ||
    text.includes("not a github")
  ) {
    return "not-github";
  }
  return null;
}

export const githubHandlers: Handlers = {
  read_pull_requests: ({ dir }) => {
    const result = spawnSync("gh", ["pr", "list", "--state", "all", "--limit", "100", "--json", FIELDS], {
      cwd: String(dir),
      encoding: "utf8",
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" },
    });
    if (result.error && (result.error as { code?: string }).code === "ENOENT") {
      return { status: "gh-missing", raw: "" };
    }
    if (result.status === 0) return { status: "ok", raw: result.stdout };
    const stderr = String(result.stderr ?? "").trim();
    const status = classify(stderr);
    if (status) return { status, raw: "" };
    throw new Error(stderr || "gh failed");
  },
};
