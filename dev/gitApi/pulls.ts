// Dev-server mirror of src-tauri/src/git/pulls.rs: gh for GitHub, glab for GitLab.
// @ts-expect-error type error without @types/node package
import { spawnSync } from "node:child_process";
import { type Handlers, run } from "./git.ts";

type Provider = "github" | "gitlab";
type Attempt =
  | { kind: "ok"; raw: string }
  | { kind: "missing" | "unauthenticated" | "no-remote" }
  | { kind: "failed"; message: string };

// Keep in step with PAGE_SIZE and GITHUB_QUERY in src-tauri/src/git/pulls.rs.
const PAGE_SIZE = 30;
const GITHUB_QUERY = `query($owner: String!, $name: String!, $states: [PullRequestState!], $after: String) { repository(owner: $owner, name: $name) { pullRequests(first: ${PAGE_SIZE}, states: $states, after: $after, orderBy: {field: CREATED_AT, direction: DESC}) { totalCount pageInfo { hasNextPage endCursor } nodes { number title state isDraft headRefName baseRefName isCrossRepository url updatedAt reviewDecision author { login } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }`;

const PROGRAM: Record<Provider, string> = { github: "gh", gitlab: "glab" };

function cliArgs(provider: Provider, scope: string, cursor: string | null): string[] {
  const openOnly = scope === "open";
  if (provider === "github") {
    return [
      "api", "graphql", "-F", "owner={owner}", "-F", "name={repo}",
      ...(openOnly ? ["-F", "states[]=OPEN"] : []),
      ...(cursor ? ["-f", `after=${cursor}`] : []),
      "-f", `query=${GITHUB_QUERY}`,
    ];
  }
  const page = Number.parseInt(cursor ?? "", 10);
  return [
    "mr", "list", "--per-page", String(PAGE_SIZE), "--page", String(Number.isFinite(page) && page > 0 ? page : 1),
    ...(openOnly ? [] : ["--all"]),
    "--output", "json",
  ];
}

// "No remote" first: its message ends with a hint to `auth login`.
function classify(stderr: string): Attempt | null {
  const text = stderr.toLowerCase();
  if (
    ["none of the git remotes", "no github remotes", "no gitlab remotes", "could not determine base repo", "no git remotes found", "not a github", "not a gitlab"].some(
      (needle) => text.includes(needle),
    )
  ) {
    return { kind: "no-remote" };
  }
  if (["auth login", "not logged in", "authentication", "http 401", "401 unauthorized"].some((needle) => text.includes(needle))) {
    return { kind: "unauthenticated" };
  }
  return null;
}

function hostOf(url: string): string | null {
  const trimmed = url.trim();
  const scheme = trimmed.indexOf("://");
  const authority = scheme === -1 ? trimmed.split(/[:/]/)[0] : trimmed.slice(scheme + 3).split("/")[0];
  const host = authority.split("@").pop()?.split(":")[0] ?? "";
  return host ? host.toLowerCase() : null;
}

function remoteHost(dir: string): string | null {
  try {
    return hostOf(run(dir, ["remote", "get-url", "origin"]));
  } catch {
    try {
      const first = run(dir, ["remote"]).split("\n")[0];
      return first ? hostOf(run(dir, ["remote", "get-url", first])) : null;
    } catch {
      return null;
    }
  }
}

function attempt(dir: string, provider: Provider, scope: string, cursor: string | null): Attempt {
  const program = PROGRAM[provider];
  const result = spawnSync(program, cliArgs(provider, scope, cursor), {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_PROMPT: "1", GLAB_CHECK_UPDATE: "false", NO_COLOR: "1" },
  });
  if (result.error && (result.error as { code?: string }).code === "ENOENT") return { kind: "missing" };
  if (result.status === 0) return { kind: "ok", raw: result.stdout };
  const stderr = String(result.stderr ?? "").trim();
  return classify(stderr) ?? { kind: "failed", message: stderr || `${program} failed` };
}

const answer = (status: string, provider: Provider | "", raw = "") => ({ status, provider, raw });

export const pullsHandlers: Handlers = {
  read_pull_requests: ({ dir, scope, cursor, provider: asked }) => {
    const host = remoteHost(String(dir));
    const named = asked === "github" || asked === "gitlab" ? (asked as Provider) : null;
    const matched = named !== null || (host !== null && (host.includes("gitlab") || host.includes("github")));
    const providers: Provider[] = named
      ? [named]
      : host?.includes("gitlab")
        ? ["gitlab"]
        : host?.includes("github")
          ? ["github"]
          : ["github", "gitlab"];

    const attempts: Array<[Provider, Attempt]> = [];
    for (const provider of providers) {
      const result = attempt(String(dir), provider, scope === "all" ? "all" : "open", typeof cursor === "string" ? cursor : null);
      attempts.push([provider, result]);
      if (result.kind === "ok") return answer("ok", provider, result.raw);
    }
    // A real failure surfaces only from a matched host or the first provider asked.
    for (const [index, [, result]] of attempts.entries()) {
      if (result.kind === "failed" && (matched || index === 0)) throw new Error(result.message);
    }
    const signedOut = attempts.find(([, result]) => result.kind === "unauthenticated");
    if (signedOut) return answer("cli-unauthenticated", signedOut[0]);
    if (matched) {
      const [provider, result] = attempts[0];
      return answer(result.kind === "missing" ? "cli-missing" : "cli-unauthenticated", provider);
    }
    if (attempts.every(([, result]) => result.kind === "missing")) return answer("cli-missing", "");
    return answer("unsupported-remote", "");
  },
};
