// Shared sizing for the commit table: header and rows must line up.
import assert from "node:assert/strict";
import { test } from "vitest";

import { DEFAULT_COLUMNS, commitGrids, messageTrack, normalizeOrder } from "./tableLayout";

test("header and row grids share every column the rows need to line up under", () => {
  const { header, row } = commitGrids(DEFAULT_COLUMNS);
  assert.ok(header.startsWith("var(--graph-width) "), "the header leads with the graph column");
  assert.ok(!row.includes("graph"), "rows draw the graph in their own SVG, not a grid column");
  assert.equal(header, `var(--graph-width) ${row}`, "the header is the row plus the graph");
  for (const column of ["--col-message", "--col-author", "--col-date", "--col-hash", "--col-spacer"]) {
    assert.ok(row.includes(column), `grid drift in ${column}`);
  }
});

test("a hidden column drops its track so no empty gap is left behind", () => {
  const { row } = commitGrids({ author: false, date: true, hash: false });
  assert.equal(row, "var(--col-message) var(--col-date) var(--col-spacer)");
});

test("the track list follows the column order", () => {
  const { row } = commitGrids(DEFAULT_COLUMNS, ["date", "message", "hash", "author"]);
  assert.equal(row, "var(--col-date) var(--col-message) var(--col-hash) var(--col-author) var(--col-spacer)");
});

test("a stored order is repaired: junk and repeats dropped, missing columns appended", () => {
  assert.deepEqual(normalizeOrder(["hash", "hash", "nope", "message"]), ["hash", "message", "author", "date"]);
  assert.deepEqual(normalizeOrder(null), ["message", "author", "date", "hash"]);
});

test("a pinned message width can shrink to its minimum instead of overflowing the table", () => {
  assert.equal(messageTrack(null), "minmax(0,1fr)");
  assert.equal(messageTrack(480), "minmax(160px,480px)");
});
