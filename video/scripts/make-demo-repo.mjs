// Builds the throwaway "orbit" repo the showcase recording drives: several branches, merges, tags,
// a stash, uncommitted edits and a branch that conflicts with main. Usage: node make-demo-repo.mjs <dir>
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "demo-repo");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

let clock = Date.UTC(2026, 9, 1, 9, 0, 0) / 1000;
const people = [
  ["Maya Chen", "maya@orbit.dev"],
  ["Jonas Weber", "jonas@orbit.dev"],
  ["Priya Nair", "priya@orbit.dev"],
];
let who = 0;

const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const write = (file, text) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
};

function commit(message, files = {}, author = who++ % people.length) {
  for (const [file, text] of Object.entries(files)) write(file, text);
  git("add", "-A");
  clock += 3600 * (3 + (who % 5));
  const [name, email] = people[author];
  const date = `${clock} +0000`;
  execFileSync("git", ["commit", "-q", "-m", message], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: date },
  });
}
function merge(branch, message) {
  clock += 3600 * 2;
  const date = `${clock} +0000`;
  execFileSync("git", ["merge", "--no-ff", "-q", "-m", message, branch], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_NAME: people[0][0], GIT_AUTHOR_EMAIL: people[0][1], GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: people[0][0], GIT_COMMITTER_EMAIL: people[0][1], GIT_COMMITTER_DATE: date },
  });
}

git("init", "-q", "-b", "main");
git("config", "user.name", people[0][0]);
git("config", "user.email", people[0][1]);
git("config", "core.autocrlf", "false");

const theme = (accent) => `export const theme = {
  accent: "${accent}",
  radius: 12,
  font: "Inter, system-ui, sans-serif",
};
`;
const search = (body) => `import { index } from "./index";

export function search(query: string) {
${body}
}
`;
const server = (port) => `import { createServer } from "node:http";
import { route } from "./router";

const PORT = ${port};

export function start() {
  const server = createServer((req, res) => route(req, res));
  server.listen(PORT);
  return server;
}
`;

commit("Initial commit", {
  "README.md": "# Orbit\n\nA tiny job scheduler.\n",
  "src/server.ts": server(3000),
  "src/router.ts": "export function route(req: unknown, res: unknown) {\n  return { req, res };\n}\n",
  "src/theme.ts": theme("#6e56cf"),
});
commit("Add job queue", { "src/queue.ts": "export const queue: string[] = [];\n\nexport function push(job: string) {\n  queue.push(job);\n}\n" });
commit("Add retry with backoff", { "src/retry.ts": "export async function retry<T>(fn: () => Promise<T>, tries = 3) {\n  for (let i = 0; ; i++) {\n    try {\n      return await fn();\n    } catch (error) {\n      if (i >= tries) throw error;\n    }\n  }\n}\n" });
git("tag", "v0.1.0");

git("checkout", "-q", "-b", "feature/search");
commit("Index jobs by name", { "src/index.ts": "export const index = new Map<string, string>();\n" });
commit("Add a search endpoint", { "src/search.ts": search("  return [...index.keys()].filter((name) => name.includes(query));") });

git("checkout", "-q", "main");
commit("Log every request", { "src/router.ts": "export function route(req: unknown, res: unknown) {\n  console.log(\"request\");\n  return { req, res };\n}\n" });
git("checkout", "-q", "-b", "feature/auth");
commit("Add token auth", { "src/auth.ts": "export function verify(token: string) {\n  return token.startsWith(\"orb_\");\n}\n" });
commit("Reject expired tokens", { "src/auth.ts": "export function verify(token: string, now = Date.now()) {\n  const [, expires] = token.split(\".\");\n  return token.startsWith(\"orb_\") && Number(expires) > now;\n}\n" });

git("checkout", "-q", "main");
commit("Document the queue", { "README.md": "# Orbit\n\nA tiny job scheduler.\n\n## Queue\n\nJobs run in the order they are pushed.\n" });
merge("feature/search", "Merge feature/search into main");
commit("Make search case-insensitive", { "src/search.ts": search("  const q = query.toLowerCase();\n  return [...index.keys()].filter((name) => name.toLowerCase().includes(q));") });
git("checkout", "-q", "-b", "fix/port");
commit("Read the port from the environment", { "src/server.ts": server(3000).replace("const PORT = 3000;", "const PORT = Number(process.env.PORT ?? 3000);") });
git("checkout", "-q", "main");
merge("fix/port", "Merge fix/port into main");
git("tag", "v0.2.0");

// Conflicting branches: both rewrite the accent colour.
git("checkout", "-q", "-b", "feature/dark-theme");
commit("Use a deeper accent for dark mode", { "src/theme.ts": theme("#563d9a") });
git("checkout", "-q", "main");
commit("Brighten the accent", { "src/theme.ts": theme("#8b6cf0") });
commit("Add a health check route", { "src/health.ts": "export const health = () => ({ ok: true });\n" });
git("remote", "add", "origin", "https://github.com/acme/orbit.git");

// A parked change on the stash, then live edits (two hunks in one file, one untracked file).
git("checkout", "-q", "feature/auth");
write("src/auth.ts", "// parked\nexport function verify(token: string) {\n  return token.length > 0;\n}\n");
git("stash", "push", "-q", "-m", "Try looser token check");
git("checkout", "-q", "main");

const base = [
  "import { createServer } from \"node:http\";",
  "import { route } from \"./router\";",
  "",
  "const PORT = Number(process.env.PORT ?? 3000);",
  "",
  "export function start() {",
  "  const server = createServer((req, res) => route(req, res));",
  "  server.listen(PORT);",
  "  return server;",
  "}",
  "",
];
const edited = [...base];
edited[3] = "const PORT = Number(process.env.PORT ?? 8080);";
edited.push("export function stop(server: ReturnType<typeof start>) {", "  server.close();", "}", "");
edited.splice(7, 0, "  console.log(`listening on ${PORT}`);");
write("src/server.ts", edited.join("\n"));
write("src/metrics.ts", "export const metrics = { jobs: 0, failures: 0 };\n");

console.log(dir);
