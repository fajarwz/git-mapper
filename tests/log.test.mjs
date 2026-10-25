// Regression checks for the log/stash parsing and ref pill shaping.
// Run with `npm test` (Node's test runner; the TS modules load through Vite's SSR loader).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let parseStashes;
let orderRefs;
let server;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    configFile: false,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  ({ parseStashes } = await server.ssrLoadModule("/src/lib/gitLogParser.ts"));
  ({ orderRefs } = await server.ssrLoadModule("/src/lib/refOrder.ts"));
});

after(async () => {
  await server.close();
});

const NUL = String.fromCharCode(0);
const RS = String.fromCharCode(30);

/** One `read_stashes` record, shaped the way git prints it (record + newline). */
const stashRecord = (selector, hash, parents, date, message) =>
  [selector, hash, parents, "fajarwz", "fajar@example.com", date, message].join(NUL) + RS + "\n";

test("stash records parse into one entry each, newest first", () => {
  const raw =
    stashRecord(
      "stash@{0}",
      "aaa111",
      "base1 index1 untracked1",
      "2026-10-25T11:03:15+07:00",
      "WIP on main: base1 feat: one",
    ) +
    stashRecord(
      "stash@{1}",
      "bbb222",
      "base1 index2",
      "2026-10-25T10:50:13+07:00",
      "WIP on main: base1 feat: one",
    );

  const stashes = parseStashes(raw);
  assert.equal(stashes.length, 2);
  assert.deepEqual(
    stashes.map((stash) => stash.selector),
    ["stash@{0}", "stash@{1}"],
    "the newest entry leads, as git lists it, and the selector is not polluted by the record newline",
  );
  assert.deepEqual(
    stashes[0].parents,
    ["base1", "index1", "untracked1"],
    "git's parents are kept: the loader shows only the first",
  );
  assert.equal(stashes[1].hash, "bbb222");
  assert.equal(stashes[1].date, "2026-10-25T10:50:13+07:00");
  assert.equal(parseStashes("").length, 0);
  assert.equal(parseStashes(RS).length, 0, "an empty list is not one blank entry");
  assert.equal(parseStashes(`stash@{0}${NUL}only-a-hash${RS}`).length, 0, "a short record is skipped");
});

test("merging two copies of one ref keeps the remote pairing", () => {
  // The log decoration and the for-each-ref tip describe the same branch; only the tip knows
  // the remote pair. Keeping the poorer copy is what made a refreshed pill read "main" and
  // lose "main | origin".
  const decoration = [{ type: "branch", name: "main", isCurrent: true }];
  const tips = [
    { type: "branch", name: "main", isCurrent: true },
    { type: "remote", name: "origin/main" },
  ];
  const merged = orderRefs([...decoration, ...tips]);
  assert.deepEqual(merged, [
    { type: "branch", name: "main", isCurrent: true, withRemote: "origin" },
  ]);

  // Same input from either side has to agree, or a refresh re-pills and flashes the row.
  assert.deepEqual(orderRefs(tips), merged);
});

test("ref pills keep branch, tag and stash order and drop origin/HEAD", () => {
  const refs = orderRefs([
    { type: "remote", name: "origin/HEAD" },
    { type: "remote", name: "upstream/release" },
    { type: "tag", name: "v1.0.0" },
    { type: "stash", name: "stash@{0}" },
    { type: "branch", name: "main" },
    { type: "remote", name: "origin/main" },
  ]);
  assert.deepEqual(
    refs.map((ref) => `${ref.type}:${ref.name}`),
    ["stash:stash@{0}", "branch:main", "tag:v1.0.0", "remote:upstream/release"],
    "stash leads, then branches, tags and unpaired remotes; origin/HEAD is noise",
  );
  assert.equal(refs[1].withRemote, "origin", "the paired remote is folded into its branch");
});
