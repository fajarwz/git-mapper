// Dev-server mirror of src-tauri/src/git/pulls.rs: gh for GitHub, glab for GitLab.
// @ts-expect-error type error without @types/node package
import { spawnSync } from "node:child_process";
import { PullRequestProvider, PullRequestsStatus, PullScope } from "../../src/types.ts";
import { type Handlers, run } from "./git.ts";

/** How one CLI run ended; mirrors the Rust `Attempt`. */
enum Kind {
  Ok = "ok",
  Missing = "missing",
  Unauthenticated = "unauthenticated",
  NoRemote = "no-remote",
  Failed = "failed",
}

type Attempt = { kind: Kind.Ok; raw: string } | { kind: Kind.Failed; message: string } | { kind: Exclude<Kind, Kind.Ok | Kind.Failed> };

// Keep in step with PAGE_SIZE and GITHUB_QUERY in src-tauri/src/git/pulls.rs.
const PAGE_SIZE = 30;
const GITHUB_QUERY = `query($owner: String!, $name: String!, $states: [PullRequestState!], $after: String) { repository(owner: $owner, name: $name) { pullRequests(first: ${PAGE_SIZE}, states: $states, after: $after, orderBy: {field: CREATED_AT, direction: DESC}) { totalCount pageInfo { hasNextPage endCursor } nodes { number title state isDraft headRefName baseRefName isCrossRepository url updatedAt reviewDecision mergeCommit { oid } author { login } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }`;

const GITHUB_SEARCH = `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: ${PAGE_SIZE}, after: $after) { issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { number title state isDraft headRefName baseRefName isCrossRepository url updatedAt reviewDecision mergeCommit { oid } author { login } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }`;

const PROGRAM: Record<PullRequestProvider, string> = {
  [PullRequestProvider.GitHub]: "gh",
  [PullRequestProvider.GitLab]: "glab",
};

function cliArgs(provider: PullRequestProvider, scope: PullScope, cursor: string | null, query: string): string[] {
  if (provider === PullRequestProvider.GitHub) {
    const after = cursor ? ["-f", `after=${cursor}`] : [];
    if (query) {
      const state = scope === PullScope.Open ? " is:open" : scope === PullScope.Merged ? " is:merged" : "";
      return ["api", "graphql", "-F", `q=repo:{owner}/{repo} is:pr${state} sort:created-desc ${query}`, ...after, "-f", `query=${GITHUB_SEARCH}`];
    }
    const states = scope === PullScope.Open ? ["-F", "states[]=OPEN"] : scope === PullScope.Merged ? ["-F", "states[]=MERGED"] : [];
    return ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", ...states, ...after, "-f", `query=${GITHUB_QUERY}`];
  }
  const page = Number.parseInt(cursor ?? "", 10);
  return [
    "mr", "list", "--per-page", String(PAGE_SIZE), "--page", String(Number.isFinite(page) && page > 0 ? page : 1),
    ...(scope === PullScope.Merged ? ["--merged"] : scope === PullScope.Open ? [] : ["--all"]),
    ...(query ? ["--search", query] : []),
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
    return { kind: Kind.NoRemote };
  }
  if (["auth login", "not logged in", "authentication", "http 401", "401 unauthorized"].some((needle) => text.includes(needle))) {
    return { kind: Kind.Unauthenticated };
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

function attempt(dir: string, provider: PullRequestProvider, scope: PullScope, cursor: string | null, query: string): Attempt {
  const program = PROGRAM[provider];
  const result = spawnSync(program, cliArgs(provider, scope, cursor, query), {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_PROMPT: "1", GLAB_CHECK_UPDATE: "false", NO_COLOR: "1" },
  });
  if (result.error && (result.error as { code?: string }).code === "ENOENT") return { kind: Kind.Missing };
  if (result.status === 0) return { kind: Kind.Ok, raw: result.stdout };
  const stderr = String(result.stderr ?? "").trim();
  return classify(stderr) ?? { kind: Kind.Failed, message: stderr || `${program} failed` };
}

const answer = (status: PullRequestsStatus, provider: PullRequestProvider | null, raw = "") => ({ status, provider, raw });

/** A scope or provider off the wire; anything unknown is refused the way serde refuses it in Rust. */
function known<T extends string>(all: Record<string, T>, value: unknown): T | null {
  return Object.values(all).find((member) => member === value) ?? null;
}

export const pullsHandlers: Handlers = {
  read_pull_requests: ({ dir, scope: askedScope, cursor, provider: asked, query }) => {
    const scope = known(PullScope, askedScope);
    if (scope === null) throw new Error(`unknown scope ${String(askedScope)}`);
    const host = remoteHost(String(dir));
    const named = known(PullRequestProvider, asked);
    const matched = named !== null || (host !== null && (host.includes("gitlab") || host.includes("github")));
    const providers: PullRequestProvider[] = named
      ? [named]
      : host?.includes("gitlab")
        ? [PullRequestProvider.GitLab]
        : host?.includes("github")
          ? [PullRequestProvider.GitHub]
          : [PullRequestProvider.GitHub, PullRequestProvider.GitLab];

    const attempts: Array<[PullRequestProvider, Attempt]> = [];
    for (const provider of providers) {
      const result = attempt(
        String(dir),
        provider,
        scope,
        typeof cursor === "string" ? cursor : null,
        typeof query === "string" ? query.trim() : "",
      );
      attempts.push([provider, result]);
      if (result.kind === Kind.Ok) return answer(PullRequestsStatus.Ok, provider, result.raw);
    }
    // A real failure surfaces only from a matched host or the first provider asked.
    for (const [index, [, result]] of attempts.entries()) {
      if (result.kind === Kind.Failed && (matched || index === 0)) throw new Error(result.message);
    }
    const signedOut = attempts.find(([, result]) => result.kind === Kind.Unauthenticated);
    if (signedOut) return answer(PullRequestsStatus.CliUnauthenticated, signedOut[0]);
    if (matched) {
      const [provider, result] = attempts[0];
      return answer(result.kind === Kind.Missing ? PullRequestsStatus.CliMissing : PullRequestsStatus.CliUnauthenticated, provider);
    }
    if (attempts.every(([, result]) => result.kind === Kind.Missing)) return answer(PullRequestsStatus.CliMissing, null);
    return answer(PullRequestsStatus.UnsupportedRemote, null);
  },
};
