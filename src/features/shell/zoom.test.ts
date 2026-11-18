import assert from "node:assert/strict";
import { test } from "vitest";

import { ZOOM_MAX, ZOOM_MIN, nextZoom, zoomAction } from "./zoom";

test("nextZoom steps by 10%, clamps at both ends and resets to 100%", () => {
  assert.equal(nextZoom(1, "in"), 1.1);
  assert.equal(nextZoom(1.1, "out"), 1);
  assert.equal(nextZoom(1.3, "reset"), 1);
  assert.equal(nextZoom(ZOOM_MAX, "in"), ZOOM_MAX);
  assert.equal(nextZoom(ZOOM_MIN, "out"), ZOOM_MIN);
  let z = 1;
  for (let i = 0; i < 7; i++) z = nextZoom(z, "in");
  assert.equal(z, 1.7, "repeated steps do not accumulate float drift");
});

test("zoomAction maps Ctrl/Cmd + = + - 0 and ignores everything else", () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = { ctrlKey: true }) =>
    zoomAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });
  assert.equal(key("="), "in");
  assert.equal(key("+"), "in");
  assert.equal(key("-"), "out");
  assert.equal(key("0", { metaKey: true }), "reset");
  assert.equal(key("=", {}), null, "needs Ctrl or Cmd");
  assert.equal(key("a"), null);
  assert.equal(key("=", { ctrlKey: true, altKey: true }), null);
});
