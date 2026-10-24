// Regression checks for the commit graph: colour identity, lane geometry, determinism.
// Run with `npm test` (Node's test runner; the TS modules load through Vite's SSR loader,
// because the repo ships no bundler-side test tooling).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let layoutGraph;
let LINE_COLOR_COUNT;
let buildEdges;
let laneX;
let graphWidth;
let ROW_HEIGHT;
let LANE_WIDTH;
let GRAPH_PADDING_X;
let LINE_COLORS;
let server;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    configFile: false,
    logLevel: "error",
    server: { middlewareMode: true },
    appType: "custom",
  });
  ({ layoutGraph, LINE_COLOR_COUNT } = await server.ssrLoadModule("/src/lib/graphLanes.ts"));
  ({ buildEdges, laneX, graphWidth, ROW_HEIGHT, LANE_WIDTH, GRAPH_PADDING_X, LINE_COLORS } =
    await server.ssrLoadModule("/src/lib/graphGeometry.ts"));
});

after(async () => {
  await server.close();
});

const commits = (rows) => rows.map(([hash, ...parents]) => ({ hash, parents }));
const short = (hash) => hash.slice(0, 6);
const edgesOf = (rows) => buildEdges(layoutGraph(commits(rows)));

/**
 * Invariants every history has to satisfy.
 *
 * - A line that is running before a row still runs after it, with the same colour, unless the row
 *   consumed it (its commit is the one being drawn) or it forked into a merge parent.
 * - The first parent continues its child's line in the same colour (this is what stops a linear
 *   run from changing hue when lanes shift underneath it).
 * - Nothing is drawn outside the rows, and no two lanes share an x.
 */
function checkInvariants(rows) {
  const list = commits(rows);
  const layout = layoutGraph(list);

  layout.rows.forEach((row, index) => {
    const commit = list[index];
    const lane = layout.lanes[index];

    // One line per pending commit: the duplicate-reservation bug drew the same parent as several
    // parallel lines that only met rows later.
    const hashes = row.after.map((slot) => slot.hash);
    assert.equal(new Set(hashes).size, hashes.length, `row ${index}: ${hashes.length} lines for ${new Set(hashes).size} commits`);

    for (const slot of row.after) {
      const carried = row.above.some((entry) => entry.hash === slot.hash && entry.color === slot.color);
      const isFirstParent = commit.parents[0] === slot.hash && row.above[lane]?.color === slot.color;
      const isMergeParent = commit.parents.slice(1).includes(slot.hash);
      const isOwnTip = row.tip && slot.hash === commit.hash;
      assert.ok(
        carried || isFirstParent || isMergeParent || isOwnTip,
        `row ${index}: line ${short(slot.hash)} appeared with colour ${slot.color} out of nowhere`,
      );
    }

    for (const entry of row.above) {
      const consumed = entry.hash === commit.hash;
      const continued = row.after.some((slot) => slot.hash === entry.hash && slot.color === entry.color);
      const forked = commit.parents.includes(entry.hash);
      assert.ok(consumed || continued || forked, `row ${index}: line ${short(entry.hash)} vanished`);
    }
  });

  const xs = new Set();
  for (let lane = 0; lane < layout.laneCount; lane += 1) {
    const x = laneX(lane);
    assert.ok(!xs.has(x), `lanes collide at x=${x}`);
    xs.add(x);
  }

  const width = graphWidth(layout.laneCount);
  assert.ok(width >= laneX(layout.laneCount - 1), `width ${width} clips lane ${layout.laneCount - 1}`);

  for (const edge of edgesOf(rows)) {
    assert.ok(edge.color, `edge ${edge.key} has no colour`);
    assert.ok(Array.isArray(LINE_COLORS) && edge.color.length > 0);
  }

  // A straight piece must be vertical; a bend must move horizontally only across one row band.
  for (const edge of edgesOf(rows)) {
    const numbers = edge.path.match(/-?\d+(\.\d+)?/g).map(Number);
    const ys = numbers.filter((_, position) => position % 2 === 1);
    assert.ok(Math.max(...ys) <= rows.length * ROW_HEIGHT, `edge ${edge.key} is drawn outside the graph`);
  }

  return layout;
}

test("linear history is one straight line in one colour", () => {
  const rows = [["c3", "c2"], ["c2", "c1"], ["c1"]];
  const layout = checkInvariants(rows);
  assert.deepEqual(layout.lanes, [0, 0, 0]);
  assert.deepEqual(layout.colors, [0, 0, 0]);

  const edges = edgesOf(rows);
  for (const edge of edges) {
    const numbers = edge.path.match(/-?\d+(\.\d+)?/g).map(Number);
    const xs = numbers.filter((_, position) => position % 2 === 0);
    assert.equal(new Set(xs).size, 1, "a linear run must not move horizontally");
    assert.equal(edge.color, LINE_COLORS[0]);
  }
});

test("a line keeps its colour when a neighbouring lane closes and it shifts left", () => {
  // The left lane ends at a root while a line on its right keeps running, so that line shifts
  // one column left on the next row. It must arrive in the same colour.
  const rows = [
    ["tip-a", "base"],
    ["tip-b", "other"],
    ["base"],
    ["other"],
  ];
  const layout = checkInvariants(rows);
  const before = layout.rows[1].after.findIndex((slot) => slot.hash === "other");
  const moved = layout.rows[3].above.findIndex((slot) => slot.hash === "other");
  assert.notEqual(before, moved, "the line must actually change lane");
  assert.equal(layout.rows[1].after[before].color, layout.rows[3].above[moved].color,
    "the line changed colour when its lane moved");
});

test("two neighbours never share a colour", () => {
  const rows = [
    ["a", "base"],
    ["b", "base"],
    ["c", "base"],
    ["d", "base"],
    ["base"],
  ];
  const layout = checkInvariants(rows);
  const colours = layout.rows[0].after.map((slot) => slot.color);
  assert.equal(new Set(colours).size, colours.length);
});

test("a merge keeps its line and gives the second parent a new one", () => {
  const rows = [
    ["merge", "main-1", "side-1"],
    ["main-1", "base"],
    ["side-1", "base"],
    ["base"],
  ];
  const layout = checkInvariants(rows);
  const leaving = layout.rows[0].after;
  assert.equal(leaving.length, 2);
  assert.notEqual(leaving[0].color, leaving[1].color, "a merge must not draw both parents in one hue");

  // The merge commit's dot sits on the line that continues into its first parent.
  assert.equal(layout.colors[0], leaving[0].color, "the first-parent line must keep the merge's colour");
  assert.equal(leaving[0].hash, "main-1");
  assert.equal(leaving[1].hash, "side-1");
});

test("more lanes than the palette still get their own x and a wide enough graph", () => {
  // Distinct chains: sharing one parent would join them into a single line, which is correct.
  const rows = [];
  for (let index = 0; index < LINE_COLOR_COUNT + 4; index += 1) rows.push([`tip${index}`, `parent${index}`]);
  const layout = checkInvariants(rows);
  assert.ok(layout.laneCount > LINE_COLOR_COUNT, "fixture must exceed the palette");

  const xs = new Set();
  for (let lane = 0; lane < layout.laneCount; lane += 1) {
    const x = laneX(lane);
    assert.ok(!xs.has(x), `lane ${lane} reuses x=${x}`);
    xs.add(x);
  }
  assert.equal(graphWidth(layout.laneCount), laneX(layout.laneCount - 1) + GRAPH_PADDING_X);
});

test("a parent with several children keeps one line and every child joins it", () => {
  const rows = [
    ["child-1", "base"],
    ["child-2", "base"],
    ["child-3", "base"],
    ["child-4", "base"],
    ["child-5", "base"],
    ["base"],
  ];
  const layout = checkInvariants(rows);

  for (const index of [0, 1, 2, 3, 4]) {
    const lines = layout.rows[index].after.filter((slot) => slot.hash === "base");
    assert.equal(lines.length, 1, `row ${index} reserved base twice`);
  }
  assert.equal(layout.rows[5].above.length, 1, "the parent arrives on a single line");

  // Each later child's dot bends into the one line that already exists for the parent.
  const edges = edgesOf(rows);
  const joins = edges.filter((edge) => edge.key.includes("dot->join"));
  assert.equal(joins.length, 4, "four children must bend into the parent line");
  assert.ok(edges.some((edge) => edge.key === "r0:dot->0"), "the first child starts the parent line");
});

test("identical input produces identical layout and colours", () => {
  const rows = [
    ["m2", "m1", "side-2"],
    ["m1", "root", "side-1"],
    ["side-2", "side-1"],
    ["side-1", "root"],
    ["root"],
  ];
  const first = layoutGraph(commits(rows));
  const second = layoutGraph(commits(rows));
  assert.deepEqual(second, first);
  assert.deepEqual(edgesOf(rows), edgesOf(rows));
});

test("a parent that is not loaded yet ends the line instead of inventing a root", () => {
  // The bottom row's parent is outside the loaded page.
  const rows = [["newest", "middle"], ["middle", "unloaded-parent"]];
  const layout = checkInvariants(rows);
  const bottom = layout.rows[1].after;
  assert.equal(bottom.length, 1);
  assert.equal(bottom[0].hash, "unloaded-parent");

  const edges = edgesOf(rows);
  const lowest = Math.max(...edges.map((edge) => {
    const numbers = edge.path.match(/-?\d+(\.\d+)?/g).map(Number);
    return Math.max(...numbers.filter((_, position) => position % 2 === 1));
  }));
  assert.ok(lowest <= rows.length * ROW_HEIGHT, "nothing may be drawn below the last row");
});
