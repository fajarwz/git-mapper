// Shared sizing for the commit table: header and rows must line up.
import assert from "node:assert/strict";
import { test } from "vitest";

import { COMMIT_HEADER_GRID, COMMIT_ROW_GRID } from "./tableLayout";

test("header and row grids share every column the rows need to line up under", () => {
  assert.ok(
    COMMIT_HEADER_GRID.startsWith("grid-cols-[var(--graph-width)_"),
    "the header leads with the graph column",
  );
  assert.ok(!COMMIT_ROW_GRID.includes("graph"), "rows draw the graph in their own SVG, not a grid column");
  for (const column of ["--col-message", "--col-author", "--col-date", "--col-hash", "--col-spacer"]) {
    assert.ok(
      COMMIT_HEADER_GRID.includes(column) && COMMIT_ROW_GRID.includes(column),
      `grid drift in ${column}`,
    );
  }
});
