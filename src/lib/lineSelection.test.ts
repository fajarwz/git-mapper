import assert from "node:assert/strict";
import { test } from "vitest";
import { changeSlots } from "./lineSelection";

test("slots count only add/remove lines and restart at each hunk", () => {
  const slots = changeSlots([
    { type: "hunk", text: "@@ -1 +1 @@" },
    { type: "context", text: "a" },
    { type: "remove", text: "b" },
    { type: "add", text: "c" },
    { type: "hunk", text: "@@ -9 +9 @@" },
    { type: "add", text: "d" },
  ]);
  assert.deepEqual(slots, [
    null,
    null,
    { hunk: 0, ordinal: 0 },
    { hunk: 0, ordinal: 1 },
    null,
    { hunk: 1, ordinal: 0 },
  ]);
});
