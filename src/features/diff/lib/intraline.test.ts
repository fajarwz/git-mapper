import assert from "node:assert/strict";
import { test } from "vitest";

import { changedRanges, intralineRanges, markHtml, markedLine } from "./intraline";

const slice = (text: string, ranges: Array<[number, number]>) =>
  ranges.map(([start, end]) => text.slice(start, end));

test("only the changed word of a one-line edit is marked, on both sides", () => {
  const oldText = '  primary: "#22a88d",';
  const newText = '  primary: "#e2557a",';
  const pair = changedRanges(oldText, newText);
  assert.ok(pair);
  assert.deepEqual(slice(oldText, pair.old), ["22a88d"]);
  assert.deepEqual(slice(newText, pair.new), ["e2557a"]);
});

test("an insertion marks only the added text and leaves the old side clean", () => {
  const pair = changedRanges("const a = 1;", "const a = 1; // note");
  assert.ok(pair);
  assert.deepEqual(pair.old, []);
  assert.ok(slice("const a = 1; // note", pair.new).join("").includes("// note"));
});

test("identical and wholly rewritten lines mark nothing", () => {
  assert.equal(changedRanges("same", "same"), null);
  assert.equal(changedRanges("alpha beta gamma", "one two three four"), null);
});

test("only equal-sized remove/add blocks are paired", () => {
  const even = [
    { type: "context", text: "x" },
    { type: "remove", text: "color: red;" },
    { type: "add", text: "color: blue;" },
  ];
  assert.deepEqual([...intralineRanges(even).keys()], [1, 2]);

  const uneven = [
    { type: "remove", text: "color: red;" },
    { type: "add", text: "color: blue;" },
    { type: "add", text: "extra: line;" },
  ];
  assert.equal(intralineRanges(uneven).size, 0);
});

test("marks go inside syntax token spans and keep the HTML well formed", () => {
  const html = '<span class="hljs-string">&quot;#22a88d&quot;</span>,';
  // The text is "#22a88d" in quotes, then a comma: offsets 2..8 are 22a88d.
  const out = markHtml(html, [[2, 8]], "m");
  assert.equal(
    out,
    '<span class="hljs-string">&quot;#<mark class="m">22a88d</mark>&quot;</span>,',
  );
  // A range spanning a tag boundary closes and reopens around it.
  const spanning = markHtml("<b>ab</b>cd", [[1, 3]], "m");
  assert.equal(spanning, '<b>a<mark class="m">b</mark></b><mark class="m">c</mark>d');
});

test("a plain row with ranges becomes escaped HTML with marks; no ranges changes nothing", () => {
  assert.equal(
    markedLine({ type: "add", text: "a < b" }, undefined, [[4, 5]]),
    'a &lt; <mark class="bg-success/40 text-inherit rounded-[2px]">b</mark>',
  );
  assert.equal(markedLine({ type: "add", text: "x" }, "<i>x</i>", undefined), "<i>x</i>");
  assert.equal(markedLine({ type: "context", text: "x" }, undefined, [[0, 1]]), undefined);
});
