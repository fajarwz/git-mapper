import assert from "node:assert/strict";
import { test } from "vitest";

import { applyChoice, parseConflictText } from "./conflictMarkers";

const FILE =
  "const palette = {\n<<<<<<< HEAD\n  primary: \"#22a88d\",\n=======\n  primary: \"#e2557a\",\n>>>>>>> feature/colors\n  ink: \"#1a1a22\",\n};\n";

test("a file splits into plain stretches and labelled blocks", () => {
  const segments = parseConflictText(FILE);
  assert.deepEqual(
    segments.map((s) => s.kind),
    ["text", "conflict", "text"],
  );
  const block = segments[1];
  assert.equal(block.kind, "conflict");
  if (block.kind !== "conflict") return;
  assert.deepEqual(block.ours, ['  primary: "#22a88d",']);
  assert.deepEqual(block.theirs, ['  primary: "#e2557a",']);
  assert.equal(block.oursLabel, "HEAD");
  assert.equal(block.theirsLabel, "feature/colors");
});

test("a choice rewrites only its own block and keeps the final newline", () => {
  const two = `${FILE}x\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> feature/colors\n`;
  assert.equal(applyChoice(two, 1, "theirs").split("\n").filter((l) => l === "b").length, 1);
  const first = applyChoice(two, 0, "ours");
  assert.ok(first.includes('"#22a88d"') && !first.includes('"#e2557a"'));
  assert.ok(first.includes("<<<<<<< HEAD\na"), "the second block is untouched");
  assert.ok(first.endsWith("\n"));
  assert.equal(applyChoice(FILE, 0, "both").includes('"#22a88d"'), true);
  assert.equal(applyChoice(FILE, 0, "both").includes('"#e2557a"'), true);
  assert.equal(applyChoice(FILE, 5, "ours"), FILE, "an unknown block changes nothing");
});

test("CRLF files keep their carriage returns, and diff3 base sections drop out", () => {
  const crlf = "a\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> side\r\nz\r\n";
  assert.equal(applyChoice(crlf, 0, "ours"), "a\r\nours\r\nz\r\n");
  const diff3 = "<<<<<<< HEAD\nours\n||||||| base\nold\n=======\ntheirs\n>>>>>>> side\n";
  const block = parseConflictText(diff3)[0];
  assert.ok(block.kind === "conflict" && block.ours.join() === "ours");
  assert.equal(applyChoice(diff3, 0, "both"), "ours\ntheirs\n");
});

test("an unterminated marker or a lone ======= is plain text", () => {
  const odd = "Title\n=======\n<<<<<<< HEAD\nnever closed\n";
  assert.deepEqual(parseConflictText(odd).map((s) => s.kind), ["text"]);
});
