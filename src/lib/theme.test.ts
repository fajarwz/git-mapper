// @vitest-environment jsdom
// Theme: storage key agreed with the head script in index.html, store/apply round-trip.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { STORAGE_KEYS } from "./persisted";
import { applyTheme, initialTheme, storeTheme } from "./theme";
test("the inline head script and theme.ts read the same storage key", () => {
  const html = readFileSync("index.html", "utf8");
  assert.ok(
    html.includes(JSON.stringify(STORAGE_KEYS.theme).slice(1, -1)),
    `${STORAGE_KEYS.theme} appears verbatim in the head script`,
  );
});

test("theme helpers store, read and apply round-trip", () => {
  localStorage.clear();
  // jsdom reports no dark preference, so the system default here is light.
  assert.equal(initialTheme(), "light", "no stored choice follows the system");
  storeTheme("light");
  assert.equal(initialTheme(), "light", "an explicit choice wins over the system");
  applyTheme("dark");
  assert.ok(document.documentElement.classList.contains("dark"));
  assert.equal(document.documentElement.style.colorScheme, "dark");
  assert.equal(initialTheme(), "light", "applying does not persist; only storeTheme does");
});
