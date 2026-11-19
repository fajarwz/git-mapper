import assert from "node:assert/strict";
import { test } from "vitest";

import { SHORTCUTS, Shortcut, shortcutGroups, withShortcut } from "./shortcuts";

test("every shortcut is listed in exactly one group", () => {
  const listed = shortcutGroups().flatMap((entry) => entry.items);
  assert.equal(listed.length, Object.values(Shortcut).length);
  assert.ok(shortcutGroups().every((entry) => entry.items.length > 0));
});

test("tooltips append the keys from the table", () => {
  assert.deepEqual(SHORTCUTS[Shortcut.NewTab].keys, ["Ctrl", "T"]);
  assert.equal(withShortcut("New tab", Shortcut.NewTab), "New tab (Ctrl+T)");
});
