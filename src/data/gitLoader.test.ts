// gitLoader behaviour against a mocked invoke(): the load/refresh/paging logic
// the UI trusts, with the Rust backend replaced by recorded git-shaped output.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

// Auto-mock cannot see the real module's exports without a factory: spell it out.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  loadRepository,
  loadMoreCommits,
  parseForEachRef,
  refreshRepository,
  type Repository,
} from "./gitLoader";

// gitLoader is one of the callers that sense `window.__TAURI_INTERNALS__` to pick
// invoke over the dev middleware; stand that global up so the mock is served.
globalThis.window = { __TAURI_INTERNALS__: true };

const NUL = String.fromCharCode(0);
const RS = String.fromCharCode(30);

/** One `read_log` record, shaped the way git prints it (tformat, \x00 fields, \x1e record). */
function logRecord(deco: string, hash: string, parents: string, subject: string): string {
  return (
    [deco, hash, "Fajar", "fajar@example.com", "2026-10-25T10:00:00+07:00", parents, subject].join(NUL) +
    RS +
    "\n"
  );
}

/** A tiny fake backend: git commands answered from in-memory state, calls recorded. */
class FakeGit {
  calls: string[] = [];
  /** Every read_log --skip, in call order: the paging window must never drift. */
  logSkips: number[] = [];
  openPath = "C:/repos/demo";
  name = "demo";
  branch = "main";
  head = "H1";
  dirty = true;
  changed = 2;
  worktree = "wt-initial";
  ahead = 0;
  behind = 0;
  // History as git would print it, newest first.
  commits: Array<{ deco: string; hash: string; parents: string; subject: string }> = [
    { deco: "(HEAD -> main)", hash: "H1", parents: "H2", subject: "feat: one" },
    { deco: "", hash: "H2", parents: "", subject: "feat: two" },
  ];
  deltaCommits: Array<{ deco: string; hash: string; parents: string; subject: string }> = [];
  order = "";
  refs = "H1\trefs/heads/main\nH1\trefs/remotes/origin/main\n";
  stashes = "";

  respond(op: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push(op);
    switch (op) {
      case "open_repository":
        return Promise.resolve({ path: this.openPath, name: this.name });
      case "read_status":
        return Promise.resolve({
          branch: this.branch,
          ahead: this.ahead,
          behind: this.behind,
          dirty: this.dirty,
          changed: this.changed,
          head: this.head,
          worktree: this.worktree,
        });
      case "read_log": {
        const page = this.commits.slice(Number(args.skip), Number(args.skip) + Number(args.limit));
        this.logSkips.push(Number(args.skip));
        return Promise.resolve(page.map((c) => logRecord(c.deco, c.hash, c.parents, c.subject)).join(""));
      }
      case "read_log_delta":
        return Promise.resolve(
          this.deltaCommits.map((c) => logRecord(c.deco, c.hash, c.parents, c.subject)).join(""),
        );
      case "read_log_order":
        return Promise.resolve(this.order);
      case "read_refs":
        return Promise.resolve(this.refs);
      case "read_stashes":
        return Promise.resolve(this.stashes);
      default:
        throw new Error(`FakeGit does not implement ${op}`);
    }
  }
}

/** Every load/refresh test starts from the same fake repository state. */
async function bootstrap(fake: FakeGit): Promise<Repository> {
  vi.mocked(invoke).mockImplementation(
    (op: string, args: Record<string, unknown>) => fake.respond(op, args),
  );
  const repo = await loadRepository("C:/repos/demo");
  fake.calls.length = 0;
  fake.logSkips.length = 0;
  return repo;
}

const hashesOf = (repo: Repository) => repo.commits.map((c) => c.hash);

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});
afterEach(() => {
  vi.mocked(invoke).mockRestore();
});

test("parseForEachRef types refs by namespace and marks the checked-out branch", () => {
  const map = parseForEachRef(
    [
      "H1\trefs/heads/main",
      "H1\trefs/remotes/origin/main",
      "H1\trefs/remotes/origin/HEAD",
      "H2\trefs/tags/v2.0.1",
      "",
      "H3\tnot-a-ref",
      "H3no-separator",
    ].join("\n"),
    "main",
  );
  assert.deepEqual(map.get("H2"), [{ type: "tag", name: "v2.0.1" }]);
  assert.equal(map.get("H3"), undefined, "junk lines are skipped, not crashed on");
  const head = map.get("H1");
  assert.deepEqual(
    head?.map((r) => `${r.type}:${r.name}:${r.isCurrent ? "current" : "-"}:${r.withRemote ?? ""}`),
    ["branch:main:current:origin"],
    "origin/HEAD is dropped and the paired remote folds into the branch pill (withRemote)",
  );
});

test("loading a repository files stashes by date under the wip row and pairs the remote", async () => {
  const fake = new FakeGit();
  fake.stashes =
    ["stash@{0}", "sss000", "H1 index1", "Fajar", "fajar@example.com", "2026-10-25T09:00:00+07:00", "WIP on main: H1 feat: one"].join(NUL) +
    RS +
    "\n";
  const repo = await bootstrap(fake);

  assert.equal(repo.branch, "main");
  assert.equal(repo.head, "H1");
  assert.equal(repo.changed, 2);
  assert.equal(repo.worktree, "wt-initial");
  assert.equal(repo.defaultCommitHash, "H1");

  assert.deepEqual(hashesOf(repo).slice(0, 4), ["wip", "H1", "H2", "sss000"],
    "wip row on top, then history; the stash files by its date, not pinned above");
  assert.equal(repo.commits[0].subject, "Uncommitted changes (2)");
  assert.deepEqual(repo.commits[0].parents, ["H1"]);
  assert.deepEqual(repo.commits[3].refs.map((r) => r.name), ["stash@{0}"]);
  assert.deepEqual(repo.commits[3].parents, ["H1"], "stash rows hang off their base commit only");

  const headPills = repo.commits[1].refs;
  assert.ok(headPills.some((r) => r.type === "branch" && r.name === "main" && r.isCurrent),
    "the checked-out branch is a current pill");
  assert.ok(headPills.some((r) => r.type === "branch" && r.withRemote === "origin"),
    "the local branch knows its remote");
});

test("a stash newer than the head lands between the wip row and history", async () => {
  const fake = new FakeGit();
  fake.stashes =
    ["stash@{0}", "sss000", "H1 index1", "Fajar", "fajar@example.com", "2026-10-25T11:00:00+07:00", "WIP on main: H1 feat: one"].join(NUL) +
    RS +
    "\n";
  const repo = await bootstrap(fake);

  assert.deepEqual(hashesOf(repo).slice(0, 3), ["wip", "sss000", "H1"],
    "a stash taken after the head commit sits directly under the wip row");
});

test("a refresh where nothing moved returns null and costs three reads", async () => {
  const fake = new FakeGit();
  const repo = await bootstrap(fake);

  const result = await refreshRepository(repo);

  assert.equal(result, null);
  assert.deepEqual(fake.calls, ["read_status", "read_refs", "read_stashes"],
    "the refresh early exit must not ask git for any log");
});

test("a new commit is spliced in git's order and untouched rows keep object identity", async () => {
  const fake = new FakeGit();
  const repo = await bootstrap(fake);
  const rowH1 = repo.commits.find((c) => c.hash === "H1");
  const rowH2 = repo.commits.find((c) => c.hash === "H2");

  fake.head = "HX";
  fake.commits = [
    { deco: "(HEAD -> main)", hash: "HX", parents: "H1", subject: "feat: three" },
    { deco: "", hash: "H1", parents: "H2", subject: "feat: one" },
    { deco: "", hash: "H2", parents: "", subject: "feat: two" },
  ];
  fake.deltaCommits = [{ deco: "", hash: "HX", parents: "H1", subject: "feat: three" }];
  fake.order = "HX\nH1\nH2\n";

  const result = await refreshRepository(repo);
  assert.ok(result !== null, "a moved head is movement");
  const refreshed = result.repo;

  assert.deepEqual(hashesOf(refreshed).slice(0, 4), ["wip", "HX", "H1", "H2"],
    "the delta is spliced where git's own order puts it");
  assert.deepEqual(refreshed.commits[0].parents, ["HX"], "the wip row hangs off the new head");
  assert.equal(refreshed.head, "HX");
  assert.deepEqual(result.touched, ["HX"], "only the arrival flashes; identity-reused rows do not");
  assert.equal(refreshed.commits.find((c) => c.hash === "H1"), rowH1,
    "untouched commits keep object identity (memoized rows skip their render)");
  assert.equal(refreshed.commits.find((c) => c.hash === "H2"), rowH2);
});

test("editing a file without adding paths refreshes the wip row and reads no log", async () => {
  const fake = new FakeGit();
  const repo = await bootstrap(fake);
  const rowH1 = repo.commits.find((c) => c.hash === "H1");

  fake.worktree = "wt-edited";

  const result = await refreshRepository(repo);
  assert.ok(result !== null, "the worktree digest catches the edit");
  assert.deepEqual(result.touched, ["wip"],
    "the uncommitted row takes its flash by hand — it is not part of any log read");
  assert.ok(!fake.calls.includes("read_log_delta"), "history did not move, so no delta read");
  assert.ok(!fake.calls.includes("read_log_order"));
  assert.equal(result.repo.commits.find((c) => c.hash === "H1"), rowH1,
    "history rows are reused untouched");
});

test("a pushed branch under existing commits re-pills without reloading the log objects", async () => {
  const fake = new FakeGit();
  const repo = await bootstrap(fake);
  const rowH1 = repo.commits.find((c) => c.hash === "H1");
  const rowH2 = repo.commits.find((c) => c.hash === "H2");

  fake.refs = "H1\trefs/heads/main\nH1\trefs/remotes/origin/main\nH2\trefs/remotes/upstream/feature\n";
  fake.deltaCommits = []; // the branch tip is H2, already on screen

  const result = await refreshRepository(repo);
  assert.ok(result !== null, "a new ref counts as movement");
  assert.ok(fake.calls.includes("read_log_delta"),
    "a fetch only adding a branch still asks for the delta: those commits may be new to the window");
  const refreshed = result.repo;

  assert.equal(refreshed.commits.find((c) => c.hash === "H1"), rowH1,
    "rows whose pills did not move keep object identity");
  const rowH2after = refreshed.commits.find((c) => c.hash === "H2");
  assert.notEqual(rowH2after, rowH2, "the new tip pill replaced the row's refs");
  assert.ok(rowH2after.refs.some((r) => r.type === "remote" && r.name === "upstream/feature"));
  assert.ok(result.touched.includes("H2"));
  assert.equal(result.touched.includes("wip"), false, "the working tree did not move");
  assert.ok(!fake.calls.includes("read_log_order"), "no fresh commits, so no order read");
});

test("rewritten history (moved head over an empty delta) falls back to a full reload", async () => {
  const fake = new FakeGit();
  const repo = await bootstrap(fake);

  // History was rebased away: HEAD points at a commit that shares nothing with the old window.
  fake.head = "NX1";
  fake.commits = [
    { deco: "(HEAD -> main)", hash: "NX1", parents: "NX2", subject: "rebased: one" },
    { deco: "", hash: "NX2", parents: "", subject: "rebased: two" },
  ];
  fake.deltaCommits = [];

  const result = await refreshRepository(repo);
  assert.ok(result !== null);
  assert.ok(fake.calls.includes("open_repository"), "the fallback reloads the whole repository");
  assert.deepEqual(result.touched, ["NX1", "NX2"], "everything new flashes");
  const refreshed = result.repo;
  assert.equal(refreshed.head, "NX1");
  assert.deepEqual(hashesOf(refreshed).slice(0, 3), ["wip", "NX1", "NX2"]);
  assert.equal(refreshed.defaultCommitHash, "NX1");
});

test("paging counts history rows only: stash rows never drift the skip", async () => {
  const fake = new FakeGit();
  fake.dirty = false;
  fake.changed = 0;
  // Newest first, a linear chain: c1000 -> c999 -> ... -> c0 (root, no parent).
  fake.commits = Array.from({ length: 1001 }, (_, i) => {
    const n = 1000 - i;
    return {
      deco: n === 1000 ? "(HEAD -> main)" : "",
      hash: `c${n}`,
      parents: n === 0 ? "" : `c${n - 1}`,
      subject: `commit ${n}`,
    };
  });
  // Two stash entries in the first window: they must not push the page-2 skip past 500.
  fake.stashes =
    ["stash@{0}", "sss000", "c1000 idx1", "Fajar", "fajar@example.com", "2026-10-25T11:00:00+07:00", "WIP on main: c1000"].join(NUL) +
    RS + "\n" +
    ["stash@{1}", "sss111", "c999 idx1", "Fajar", "fajar@example.com", "2026-10-25T10:30:00+07:00", "WIP on main: c999"].join(NUL) +
    RS + "\n";

  const repo = await bootstrap(fake);
  assert.equal(repo.commits.length, 502, "wip excluded, stashes merged in, 500 history rows");

  const page2 = await loadMoreCommits(repo);
  assert.equal(page2.done, false);
  assert.deepEqual(fake.logSkips, [500],
    "page 2 skips 500 history rows — the two stash rows must not push the window past them");
  assert.equal(page2.repo.commits[0].hash, "sss000");
  assert.equal(page2.repo.commits[2].hash, "c1000",
    "the stashes (taken later than any commit) sit above the head, history follows");
  assert.equal(page2.repo.commits[502].hash, "c500",
    "page 2 continues the chain at c500 — the stash count must not eat rows");
});

test("paging appends the next page below the window and reports when history runs out", async () => {
  const fake = new FakeGit();
  fake.dirty = false;
  fake.changed = 0;
  // Newest first, a linear chain: c1000 -> c999 -> ... -> c0 (root, no parent).
  fake.commits = Array.from({ length: 1001 }, (_, i) => {
    const n = 1000 - i;
    return {
      deco: n === 1000 ? "(HEAD -> main)" : "",
      hash: `c${n}`,
      parents: n === 0 ? "" : `c${n - 1}`,
      subject: `commit ${n}`,
    };
  });
  const repo = await bootstrap(fake);
  assert.equal(repo.commits.length, 500, "the first window is capped at 500 commits");

  const page2 = await loadMoreCommits(repo);
  assert.equal(page2.done, false);
  assert.equal(page2.repo.commits.length, 1000);
  assert.equal(page2.repo.commits[0].hash, "c1000", "the loaded window stays on top");
  assert.equal(page2.repo.commits[500].hash, "c500", "page 2 continues the chain");

  const page3 = await loadMoreCommits(page2.repo);
  assert.equal(page3.done, true, "a short page ends paging — and it still appends");
  assert.equal(page3.repo.commits.length, 1001);
  assert.equal(page3.repo.commits[1000].hash, "c0", "the root commit closes the list");

  const page4 = await loadMoreCommits(page3.repo);
  assert.equal(page4.done, true, "an empty page ends paging");
  assert.equal(page4.repo, page3.repo, "no new page means no new state");
});
