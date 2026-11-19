import assert from "node:assert/strict";
import { test } from "vitest";

import { highlightSync, languageForPath, loadHighlighter } from "./highlight";

test("languageForPath maps extensions, basename files and dotfiles", () => {
  const want = [
    ["src/app.tsx", "typescript"],
    ["lib/index.mjs", "javascript"],
    ["styles/theme.scss", "scss"],
    ["composer.json", "json"],
    ["resources/views/app.blade.php", "php"],
    ["docker/Dockerfile", "dockerfile"],
    ["Dockerfile", "dockerfile"],
    ["Makefile", "makefile"],
    [".env", "ini"],
    [".env.local", "ini"],
    ["config/app.yaml", "yaml"],
    ["README.md", "markdown"],
    ["assets/logo.svg", "xml"],
    ["lib/features/reports/reports_screen.dart", "dart"],
  ] as const;
  for (const [path, language] of want) {
    assert.equal(languageForPath(path), language, path);
  }
  assert.equal(languageForPath("assets/logo.zzz"), null, "unknown extension stays plain");
  assert.equal(languageForPath("LICENSE"), null, "extension-less files stay plain");
});

test("highlighting is lazy: nothing before the load, tokens after, unknown grammars rejected", async () => {
  assert.equal(highlightSync("const x = 1;", "typescript"), null,
    "before the grammar loads there is nothing to render");
  assert.equal(await loadHighlighter("typescript"), true);
  const html = highlightSync("const x = 1;", "typescript");
  assert.ok(html !== null && html.includes("hljs-keyword"), "const is tokenized");
  assert.equal(await loadHighlighter("definitely-not-a-grammar"), false,
    "a grammar we do not ship stays plain, no throw");
});

test("a Dart file gets real tokens", async () => {
  assert.equal(await loadHighlighter("dart"), true);
  const html = highlightSync("final ctx = _keys[p]?.currentContext;", "dart");
  assert.ok(html !== null && html.includes("hljs-keyword"), "final is tokenized");
});

test("token HTML is escaped, so diff text can never inject markup", async () => {
  await loadHighlighter("json");
  const html = highlightSync('{"a":"<b>&x</b>"}', "json");
  assert.ok(html !== null);
  assert.ok(html.includes("&lt;b&gt;"), "angle brackets are escaped");
  assert.ok(!html.includes("<b>"), "no raw markup survives");
});
