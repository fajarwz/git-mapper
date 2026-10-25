// Ref pill shaping: namespace priority, remote pairing, noise dropping.
import assert from "node:assert/strict";
import { test } from "vitest";

import { orderRefs } from "./refOrder";

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

test("orderRefs pairs any remote twin, not just origin", () => {
  const refs = orderRefs([
    { type: "remote", name: "gitlab/mi-diff" },
    { type: "branch", name: "mi-diff" },
    { type: "branch", name: "solo" },
    { type: "remote", name: "origin/solo" },
  ]);
  assert.deepEqual(
    refs.map((r) => `${r.type}:${r.name}${r.withRemote ? ` | ${r.withRemote}` : ""}`),
    ["branch:mi-diff | gitlab", "branch:solo | origin"],
    "insertion order is kept: mi-diff came in first, not alphabetically",
  );
});
