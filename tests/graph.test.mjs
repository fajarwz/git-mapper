// Regression checks for the commit graph: recorded transitions, lane geometry, lane colours.
// Run with `npm test` (Node's test runner; the TS modules load through Vite's SSR loader, because
// the repo ships no bundler-side test tooling).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let layoutGraph;
let LINE_COLOR_COUNT;
let buildEdges;
let laneColor;
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
  ({ buildEdges, laneColor, laneX, graphWidth, ROW_HEIGHT, LANE_WIDTH, GRAPH_PADDING_X, LINE_COLORS } =
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
 * Invariants every history has to satisfy. These assert the graph's meaning, not that a function
 * returned an array:
 *
 * - one dot per commit, on its own line;
 * - one line per pending commit (a hash never occupies two lanes);
 * - every transition is a real parent-child relationship of the input DAG;
 * - every loaded parent is connected exactly once, and unloaded ones are recorded as gaps;
 * - a lane's colour is that lane's colour: every piece is drawn in the hue of the lane it ends in,
 *   and neighbouring lanes never share a hue;
 * - nothing is drawn outside the rows, no two lanes share an x, no segment spans two rows.
 */
function checkInvariants(rows, label = "") {
  const list = commits(rows);
  const layout = layoutGraph(list);
  const byHash = new Map(list.map((commit, index) => [commit.hash, index]));
  const prefix = label ? `${label}: ` : "";

  assert.equal(layout.lanes.length, list.length, `${prefix}one dot per commit`);
  assert.equal(layout.rows.length, list.length, `${prefix}one row per commit`);

  layout.rows.forEach((row, index) => {
    const commit = list[index];
    const lane = layout.lanes[index];
    assert.ok(lane >= 0 && lane < layout.laneCount, `${prefix}row ${index}: dot outside the lanes`);

    // One line per pending commit. A `null` slot is a hole: a line that ended at this row, which
    // keeps the columns to its right from sliding into the dot's own lane.
    for (const side of ["above", "after"]) {
      const lines = row[side].filter((slot) => slot !== null);
      assert.equal(new Set(lines).size, lines.length,
        `${prefix}row ${index}: ${side} holds ${lines.length} lines for ${new Set(lines).size} commits`);
    }

    // The line on the dot lane is this commit's own.
    if (row.above[lane]) {
      assert.equal(row.above[lane], commit.hash, `${prefix}row ${index}: another commit sits on the dot lane`);
    }

    const pointedAt = new Map();
    row.transitions.forEach((transition) => {
      const target = row.after[transition.to];
      const source = row.above[transition.from];
      switch (transition.kind) {
        case "continue":
        case "shift":
          assert.ok(source && target, `${prefix}row ${index}: ${transition.kind} leaves the graph`);
          assert.equal(source, transition.hash, `${prefix}row ${index}: ${transition.kind} starts on the wrong line`);
          assert.equal(target, transition.hash, `${prefix}row ${index}: ${transition.kind} ends on the wrong line`);
          break;
        case "fork":
          assert.ok(target, `${prefix}row ${index}: fork leaves the graph`);
          assert.equal(target, transition.hash, `${prefix}row ${index}: fork lands on the wrong line`);
          assert.ok(commit.parents.includes(transition.hash),
            `${prefix}row ${index}: fork points at ${short(transition.hash)}, not a parent`);
          break;
        case "join":
          assert.ok(source, `${prefix}row ${index}: join starts outside the graph`);
          assert.equal(source, transition.hash, `${prefix}row ${index}: join starts on the wrong line`);
          assert.equal(transition.to, lane, `${prefix}row ${index}: join misses the dot`);
          break;
        default:
          assert.fail(`${prefix}row ${index}: unknown transition ${transition.kind}`);
      }
      if (transition.kind === "fork") {
        pointedAt.set(transition.hash, (pointedAt.get(transition.hash) ?? 0) + 1);
      }
    });

    const loaded = commit.parents.filter((parent) => byHash.has(parent));
    for (const parent of loaded) {
      assert.equal(pointedAt.get(parent) ?? 0, 1, `${prefix}row ${index}: parent ${short(parent)} is not connected once`);
    }
    const unloaded = commit.parents.filter((parent) => !byHash.has(parent));
    for (const parent of unloaded) {
      assert.ok(row.gaps.some((gap) => gap.hash === parent && gap.reason === "unloaded"),
        `${prefix}row ${index}: unloaded parent ${short(parent)} was not recorded as a gap`);
      const lines = row.transitions.filter((transition) => transition.hash === parent);
      assert.ok(lines.length <= 1, `${prefix}row ${index}: unloaded parent ${short(parent)} got ${lines.length} lines`);
    }
  });

  // Geometry and lane colours.
  const xs = new Set();
  for (let lane = 0; lane < layout.laneCount; lane += 1) {
    const x = laneX(lane);
    assert.ok(!xs.has(x), `${prefix}lanes collide at x=${x}`);
    xs.add(x);
  }
  for (let lane = 0; lane + 1 < layout.laneCount; lane += 1) {
    assert.notEqual(laneColor(lane), laneColor(lane + 1), `${prefix}neighbouring lanes share a hue`);
  }
  assert.ok(graphWidth(layout.laneCount) >= laneX(layout.laneCount - 1), `${prefix}width clips the last lane`);

  const edges = buildEdges(layout);
  const seen = new Map();
  for (const edge of edges) {
    assert.ok(LINE_COLORS.includes(edge.color), `${prefix}edge ${edge.key} is not a palette colour`);

    // The colour must be the colour of the lane the piece ends in.
    const numbers = pointsOf(edge.path);
    const endX = numbers[numbers.length - 2];
    const lane = laneOfX(endX);
    assert.ok(Math.abs(laneX(lane) - endX) < 0.01, `${prefix}edge ${edge.key} does not end on a lane`);
    assert.equal(edge.color, laneColor(lane), `${prefix}edge ${edge.key} is not in lane ${lane}'s hue`);

    const previous = seen.get(edge.path);
    if (previous !== undefined) {
      assert.equal(previous, edge.color, `${prefix}${edge.path.slice(0, 30)} drawn twice in two colours`);
    }
    seen.set(edge.path, edge.color);

    const ys = numbers.filter((_, position) => position % 2 === 1);
    assert.ok(Math.max(...ys) <= list.length * ROW_HEIGHT, `${prefix}edge ${edge.key} is drawn outside the graph`);
    assert.ok(Math.min(...ys) >= 0, `${prefix}edge ${edge.key} is drawn above the first row`);
    if (!edge.key.startsWith("run")) {
      assert.ok(Math.max(...ys) - Math.min(...ys) <= ROW_HEIGHT * 1.5, `${prefix}edge ${edge.key} spans several rows`);
    }
  }

  return layout;
}

test("linear history is one straight line in one lane colour", () => {
  const rows = [["c3", "c2"], ["c2", "c1"], ["c1"]];
  const layout = checkInvariants(rows, "linear");
  assert.deepEqual(layout.lanes, [0, 0, 0]);
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
  assert.equal(layout.rows[0].after.length, 2, "both parents must have a line");

  const fork = layout.rows[0].transitions.filter((transition) => transition.kind === "fork");
  assert.equal(fork.length, 2, "both parents fork off the merge dot");
  assert.deepEqual(new Set(fork.map((transition) => transition.hash)), new Set(["main-1", "side-1"]));
  // The two parent lines sit in different lanes, so they get different hues.
  assert.notEqual(laneColor(fork[0].to), laneColor(fork[1].to));
});

test("two children sharing a parent keep one line, joined at each child", () => {
  const rows = [
    ["child-1", "base"],
    ["child-2", "base"],
    ["child-3", "base"],
    ["base"],
  ];
  const layout = checkInvariants(rows, "shared parent");
  for (const index of [0, 1, 2]) {
    assert.equal(layout.rows[index].after.filter((hash) => hash === "base").length, 1,
      `row ${index} reserved base more than once`);
  }
  assert.equal(layout.rows[3].above.length, 1, "the parent arrives on a single line");

  const stubs = layout.rows.flatMap((row) =>
    row.transitions.filter((transition) =>
      transition.kind === "fork" && transition.hash === "base" && transition.from !== transition.to));
  assert.equal(stubs.length, 2, "the second and third child bend into the existing line");
});

test("several interleaved branches stay on their own lanes", () => {
  const rows = [
    ["a2", "a1"],
    ["b2", "b1"],
    ["c2", "c1"],
    ["a1", "root"],
    ["b1", "root"],
    ["c1", "root"],
    ["root"],
  ];
  const layout = checkInvariants(rows, "interleaved");

  for (const [tip, middle] of [["a2", "a1"], ["b2", "b1"], ["c2", "c1"]]) {
    const tipIndex = rows.findIndex(([hash]) => hash === tip);
    assert.equal(layout.rows[tipIndex].after.find((hash) => hash === middle), middle,
      `${tip} must reserve ${middle}`);
    // Wherever the middle commit is drawn, its colour is the colour of the lane it sits in.
    layout.rows.forEach((row, index) => {
      const lane = row.above.indexOf(middle);
      if (lane !== -1) assert.equal(laneColor(lane), laneColor(lane), "lane colour is stable");
      assert.ok(lane === -1 || lane < layout.laneCount);
      assert.ok(index >= 0);
    });
  }
});

test("nested merges connect each parent to its own line", () => {
  const rows = [
    ["outer", "inner-merge", "side-b"],
    ["inner-merge", "main-1", "side-a"],
    ["main-1", "base"],
    ["side-a", "base"],
    ["side-b", "base"],
    ["base"],
  ];
  const layout = checkInvariants(rows, "nested merges");
  assert.ok(layout.rows[0].transitions.some((transition) => transition.hash === "side-b" && transition.kind === "fork"),
    "the outer merge must fork its second parent");
  assert.ok(layout.rows[1].transitions.some((transition) => transition.hash === "side-a" && transition.kind === "fork"),
    "the inner merge must fork its second parent");
  assert.equal(layout.rows[0].transitions.find((transition) => transition.hash === "inner-merge").kind, "fork");

  // Once both branches are open, they occupy different lanes, so they are drawn in different hues.
  const lanes = layout.rows[1].after;
  const sideA = lanes.indexOf("side-a");
  const sideB = lanes.indexOf("side-b");
  assert.ok(sideA !== -1 && sideB !== -1, "both branch lines must be open after the inner merge");
  assert.notEqual(sideA, sideB);
  assert.notEqual(laneColor(sideA), laneColor(sideB));
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
  const fork = layout.rows[0].transitions.filter((transition) => transition.kind === "fork");
  assert.equal(fork.length, 4, "first parent plus three merge parents");
  assert.equal(new Set(fork.map((transition) => transition.to)).size, 4, "each parent line needs its own lane");
  assert.equal(layout.rows[0].after.length, 4);
});

test("multiple roots and unrelated histories stay separate", () => {
  const rows = [
    ["left-2", "left-1"],
    ["right-2", "right-1"],
    ["left-1"],
    ["right-1"],
  ];
  const layout = checkInvariants(rows, "two roots");
  assert.equal(layout.rows.length, 4);
  // The left root closes its lane, so the right root shifts left one lane.
  const before = layout.rows[1].after.indexOf("right-1");
  const later = layout.rows[3].above.indexOf("right-1");
  assert.ok(before !== -1 && later !== -1);
  assert.notEqual(before, later, "the surviving line must shift left");
});

test("a history truncated at the oldest commit records the gap instead of inventing a root", () => {
  const rows = [["newest", "middle"], ["middle", "outside-window"]];
  const layout = checkInvariants(rows, "truncated");
  assert.deepEqual(layout.rows[1].gaps, [{ hash: "outside-window", reason: "unloaded" }]);
  assert.ok(layout.rows[1].after.includes("outside-window"), "the line runs off the bottom edge");
});

test("more active lanes than the palette still get their own x", () => {
  const rows = [];
  for (let index = 0; index < LINE_COLOR_COUNT + 4; index += 1) rows.push([`tip${index}`, `parent${index}`]);
  const layout = checkInvariants(rows, "wide graph");
  assert.ok(layout.laneCount > LINE_COLOR_COUNT, "fixture must exceed the palette");
  assert.notEqual(laneX(LINE_COLOR_COUNT), laneX(LINE_COLOR_COUNT + 1), "lanes past the palette share an x");
  assert.ok(graphWidth(layout.laneCount) > graphWidth(LINE_COLOR_COUNT), "the graph must widen for extra lanes");
  assert.equal(graphWidth(layout.laneCount), laneX(layout.laneCount - 1) + GRAPH_PADDING_X);
});

test("a lane that shifts left takes the next lane's colour", () => {
  // Three tips; the leftmost lane closes, so the two to its right each move one column left.
  const rows = [
    ["left-tip", "left-base"],
    ["middle-tip", "middle-base"],
    ["right-tip", "right-base"],
    ["left-base"],
    ["middle-base", "root"],
    ["right-base", "root"],
    ["root"],
  ];
  const layout = checkInvariants(rows, "lane shift");

  // A moving line is drawn twice: the bend takes the destination lane's hue, and the vertical
  // below it continues in that same hue. No piece keeps the old column's colour.
  const shifts = layout.rows.flatMap((row, index) =>
    row.transitions.filter((transition) => transition.kind === "shift").map((transition) => ({ index, transition })));
  assert.ok(shifts.length > 0, "the fixture must make a line shift");
  for (const { transition } of shifts) {
    assert.notEqual(laneColor(transition.from), laneColor(transition.to),
      "a shift must visibly change hue, and lanes must differ");
    assert.ok(transition.to >= 0 && transition.to < layout.laneCount);
  }

  // A lane only ever moves one column per row band.
  const trail = layout.rows.map((row) => row.after.indexOf("right-base"));
  for (let index = 1; index < trail.length; index += 1) {
    if (trail[index] === -1 || trail[index - 1] === -1) continue;
    assert.ok(Math.abs(trail[index] - trail[index - 1]) <= 1, "a line jumped more than one lane");
  }
});

test("merge parents whose reservations already exist are reused, not duplicated", () => {
  const rows = [
    ["side-2", "shared"],
    ["merge", "main-1", "shared"],
    ["main-1", "shared"],
    ["shared"],
  ];
  const layout = checkInvariants(rows, "existing reservations");
  assert.equal(layout.rows[1].after.filter((hash) => hash === "shared").length, 1, "the merge reused the line");
  const connections = layout.rows[1].transitions.filter(
    (transition) => transition.hash === "shared" && transition.kind === "fork");
  assert.equal(connections.length, 1, "the merge connects to the shared line exactly once");
});

test("empty and single-commit histories are handled", () => {
  const empty = layoutGraph([]);
  assert.deepEqual(empty.lanes, []);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.laneCount, 1);
  assert.equal(buildEdges(empty).length, 0);

  const single = checkInvariants([["only"]], "single");
  assert.deepEqual(single.lanes, [0]);
  assert.equal(single.ordered, true);
  assert.equal(buildEdges(single).length, 0, "a lone root has no lines");
});

test("out-of-order input is reported and never drawn upward", () => {
  const rows = [["parent", "base"], ["child", "parent"]];
  const layout = layoutGraph(commits(rows));
  assert.equal(layout.ordered, false);
  assert.ok(layout.rows[1].gaps.some((gap) => gap.hash === "parent" && gap.reason === "out-of-order"));
  assert.equal(layout.rows[1].transitions.some((transition) => transition.hash === "parent"), false);
});

test("identical input produces identical layout and transitions", () => {
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
