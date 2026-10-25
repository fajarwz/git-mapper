// Regression checks for the commit graph: branch colours, lane geometry, smooth curves.
// Run with `npm test` (Node's test runner; the TS modules load through Vite's SSR loader).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let layoutGraph;
let LINE_COLOR_COUNT;
let buildEdges;
let branchColor;
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
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  ({ layoutGraph, LINE_COLOR_COUNT } = await server.ssrLoadModule("/src/lib/graphLanes.ts"));
  ({ buildEdges, branchColor, laneX, graphWidth, ROW_HEIGHT, LANE_WIDTH, GRAPH_PADDING_X, LINE_COLORS } =
    await server.ssrLoadModule("/src/lib/graphGeometry.ts"));
});

after(async () => {
  await server.close();
});

const commits = (rows) => rows.map(([hash, ...parents]) => ({ hash, parents }));
const layoutOf = (rows) => layoutGraph(commits(rows));
const edgesOf = (rows) => buildEdges(layoutOf(rows));
const short = (hash) => String(hash).slice(0, 6);
const pointsOf = (path) => (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
const laneOfX = (x) => Math.round((x - GRAPH_PADDING_X) / LANE_WIDTH);

/**
 * Invariants every history has to satisfy:
 * - one dot per commit, on a valid lane;
 * - every unloaded parent is recorded as a gap;
 * - neighbouring active lanes never share an x coordinate;
 * - every edge path ends on a lane and uses a palette colour.
 */
function checkInvariants(rows, label = "") {
  const list = commits(rows);
  const layout = layoutGraph(list);
  const byHash = new Map(list.map((commit, index) => [commit.hash, index]));
  const prefix = label ? `${label}: ` : "";

  assert.equal(layout.lanes.length, list.length, `${prefix}one dot per commit`);
  assert.equal(layout.branchColors.length, list.length, `${prefix}one colour per commit`);

  layout.lanes.forEach((lane, index) => {
    assert.ok(lane >= 0 && lane < layout.laneCount, `${prefix}row ${index}: dot outside the lanes`);
  });

  // Unloaded parents are recorded as gaps.
  for (let index = 0; index < list.length; index++) {
    const commit = list[index];
    const unloaded = commit.parents.filter((parent) => !byHash.has(parent));
    for (const parent of unloaded) {
      assert.ok(
        layout.gaps.some((gap) => gap.hash === parent && gap.reason === "unloaded"),
        `${prefix}row ${index}: unloaded parent ${short(parent)} not recorded`,
      );
    }
  }

  // Geometry: no two lanes collide.
  const xs = new Set();
  for (let lane = 0; lane < layout.laneCount; lane += 1) {
    const x = laneX(lane);
    assert.ok(!xs.has(x), `${prefix}lanes collide at x=${x}`);
    xs.add(x);
  }
  assert.ok(
    graphWidth(layout.laneCount) >= laneX(layout.laneCount - 1),
    `${prefix}width clips the last lane`,
  );

  // Edge colours are real palette colours and end on a lane.
  const edges = buildEdges(layout);
  for (const edge of edges) {
    assert.ok(
      LINE_COLORS.includes(edge.color) || edge.color === "#808080",
      `${prefix}edge ${edge.key} is not a palette colour`,
    );
    const numbers = pointsOf(edge.path);
    const endX = numbers[numbers.length - 2];
    const lane = laneOfX(endX);
    assert.ok(Math.abs(laneX(lane) - endX) < 0.01, `${prefix}edge ${edge.key} does not end on a lane`);
    const ys = numbers.filter((_, position) => position % 2 === 1);
    assert.ok(
      Math.max(...ys) <= list.length * ROW_HEIGHT,
      `${prefix}edge ${edge.key} drawn below the graph`,
    );
    assert.ok(Math.min(...ys) >= 0, `${prefix}edge ${edge.key} drawn above the graph`);
  }

  return layout;
}

test("linear history is one straight line in one branch colour", () => {
  const rows = [["c3", "c2"], ["c2", "c1"], ["c1"]];
  const layout = checkInvariants(rows, "linear");
  assert.deepEqual(layout.lanes, [0, 0, 0]);
  assert.deepEqual(layout.branchColors, [0, 0, 0]);
  assert.ok(layout.ordered);

  for (const edge of edgesOf(rows)) {
    const xs = pointsOf(edge.path).filter((_, position) => position % 2 === 0);
    assert.equal(new Set(xs).size, 1, "a linear run must not move horizontally");
    assert.equal(edge.color, LINE_COLORS[0]);
  }
});

test("two-way divergence followed by a merge", () => {
  const rows = [
    ["merge", "main-1", "side-1"],
    ["main-1", "base"],
    ["side-1", "base"],
    ["base"],
  ];
  const layout = checkInvariants(rows, "divergence");
  // The merge forks two parent lines; they must sit in different lanes and colours.
  assert.notEqual(layout.lanes[1], layout.lanes[2], "merge parents sit in different lanes");
  assert.notEqual(branchColor(layout.branchColors[1]), branchColor(layout.branchColors[2]));
});

test("branch colour stays stable when a lane shifts", () => {
  // Three independent tips; the leftmost closes first, so the other two shift left but keep colour.
  const rows = [
    ["left-tip", "left-base"],
    ["middle-tip", "middle-base"],
    ["right-tip", "right-base"],
    ["left-base"],
    ["middle-base", "root"],
    ["right-base", "root"],
    ["root"],
  ];
  const layout = checkInvariants(rows, "shift");

  const middleColor = layout.branchColors[1];
  const rightColor = layout.branchColors[2];

  // After left-base closes, the remaining lines shift left.
  assert.ok(
    layout.lanes[4] < layout.lanes[1] || layout.lanes[5] < layout.lanes[2],
    "at least one surviving line shifted left",
  );

  // The colour of the branch is unchanged wherever it appears.
  assert.equal(layout.branchColors[4], middleColor, "middle branch kept its colour");
  assert.equal(layout.branchColors[5], rightColor, "right branch kept its colour");
});

test("two children sharing a parent keep one line", () => {
  const rows = [
    ["child-1", "base"],
    ["child-2", "base"],
    ["child-3", "base"],
    ["base"],
  ];
  const layout = checkInvariants(rows, "shared parent");
  // The first child owns the parent line; later children connect to it.
  assert.equal(layout.branchColors[0], layout.branchColors[3], "parent line inherits first child's colour");
});

test("octopus merge gives every extra parent its own line", () => {
  const rows = [
    ["octopus", "main-1", "side-a", "side-b", "side-c"],
    ["main-1", "base"],
    ["side-a", "base"],
    ["side-b", "base"],
    ["side-c", "base"],
    ["base"],
  ];
  const layout = checkInvariants(rows, "octopus");
  const lanes = new Set([layout.lanes[1], layout.lanes[2], layout.lanes[3], layout.lanes[4]]);
  assert.equal(lanes.size, 4, "each parent line needs its own lane");
});

test("multiple roots and unrelated histories stay separate", () => {
  const rows = [
    ["left-2", "left-1"],
    ["right-2", "right-1"],
    ["left-1"],
    ["right-1"],
  ];
  const layout = checkInvariants(rows, "two roots");
  assert.equal(layout.lanes.length, 4);
  assert.notEqual(layout.lanes[0], layout.lanes[1], "unrelated tips start in different lanes");
});

test("a history truncated at the oldest commit records the gap", () => {
  const rows = [["newest", "middle"], ["middle", "outside-window"]];
  const layout = checkInvariants(rows, "truncated");
  assert.ok(layout.gaps.some((gap) => gap.hash === "outside-window" && gap.reason === "unloaded"));
});

test("more active lanes than the palette still get their own x", () => {
  const rows = [];
  for (let index = 0; index < LINE_COLOR_COUNT + 4; index += 1) rows.push([`tip${index}`, `parent${index}`]);
  const layout = checkInvariants(rows, "wide graph");
  assert.ok(layout.laneCount > LINE_COLOR_COUNT, "fixture must exceed the palette");
  assert.notEqual(laneX(LINE_COLOR_COUNT), laneX(LINE_COLOR_COUNT + 1), "lanes past the palette share an x");
});

test("branch colours are reused once a branch ends", () => {
  // Two sequential unrelated branches: the first ends before the second starts, so both use colour 0.
  const rows = [
    ["a2", "a1"],
    ["a1"],
    ["b2", "b1"],
    ["b1"],
  ];
  const layout = checkInvariants(rows, "colour reuse");
  assert.equal(layout.branchColors[0], layout.branchColors[2], "ended branch's colour is reused");
});

test("empty and single-commit histories are handled", () => {
  const empty = layoutGraph([]);
  assert.deepEqual(empty.lanes, []);
  assert.deepEqual(empty.branchColors, []);
  assert.deepEqual(empty.branches, []);
  assert.equal(empty.laneCount, 1);
  assert.equal(buildEdges(empty).length, 0);

  const single = checkInvariants([["only"]], "single");
  assert.deepEqual(single.lanes, [0]);
  assert.deepEqual(single.branchColors, [0]);
  assert.equal(buildEdges(single).length, 0, "a lone root has no lines");
});

test("out-of-order input is reported", () => {
  const rows = [["parent", "base"], ["child", "parent"]];
  const layout = layoutGraph(commits(rows));
  assert.equal(layout.ordered, false);
  assert.ok(layout.gaps.some((gap) => gap.hash === "parent" && gap.reason === "out-of-order"));
});

test("identical input produces identical layout", () => {
  const rows = [
    ["m2", "m1", "side-2"],
    ["m1", "root", "side-1"],
    ["side-2", "side-1"],
    ["side-1", "root"],
    ["root"],
  ];
  assert.deepEqual(layoutOf(rows), layoutOf(rows));
  assert.deepEqual(edgesOf(rows), edgesOf(rows));
});
