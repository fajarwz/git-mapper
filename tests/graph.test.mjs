// Regression checks for the commit graph: recorded transitions, lane geometry, line colours.
// Run with `npm test` (Node's test runner; the TS modules load through Vite's SSR loader, because
// the repo ships no bundler-side test tooling).
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
const layoutOf = (rows) => layoutGraph(commits(rows));
const edgesOf = (rows) => buildEdges(layoutOf(rows));
const short = (hash) => String(hash).slice(0, 6);
const pointsOf = (path) => (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

/**
 * Invariants every history has to satisfy. These assert the graph's meaning, not just that the
 * functions return arrays:
 *
 * - one dot per commit, and the dot sits on its own line;
 * - one line per pending commit (a hash never occupies two lanes);
 * - every transition is a real parent-child relationship of the input DAG;
 * - every loaded parent has exactly one transition pointing at it;
 * - a transition's colour is the colour of the line it belongs to, on both sides;
 * - nothing is drawn outside the rows, and no two lanes share an x.
 */
function checkInvariants(rows, label = "") {
  const list = commits(rows);
  const layout = layoutGraph(list);
  const byHash = new Map(list.map((commit, index) => [commit.hash, index]));
  const prefix = label ? `${label}: ` : "";

  assert.equal(layout.lanes.length, list.length, `${prefix}one dot per commit`);
  assert.equal(layout.colors.length, list.length, `${prefix}one colour per commit`);
  assert.equal(layout.rows.length, list.length, `${prefix}one row per commit`);

  layout.rows.forEach((row, index) => {
    const commit = list[index];
    const lane = layout.lanes[index];
    assert.ok(lane >= 0 && lane < layout.laneCount, `${prefix}row ${index}: dot outside the lanes`);

    // One line per pending commit: duplicate reservations used to draw a commit several times.
    for (const side of ["above", "after"]) {
      const hashes = row[side].map((slot) => slot.hash);
      assert.equal(new Set(hashes).size, hashes.length,
        `${prefix}row ${index}: ${side} holds ${hashes.length} lines for ${new Set(hashes).size} commits`);
    }

    // The dot belongs to the line arriving on its lane.
    const own = row.above[lane];
    if (own) assert.equal(own.hash, commit.hash, `${prefix}row ${index}: another commit sits on the dot lane`);
    if (own) assert.equal(layout.colors[index], own.color, `${prefix}row ${index}: dot colour is not its line's`);

    // Every transition names a real relationship and carries its line's colour.
    const pointedAt = new Map();
    row.transitions.forEach((transition) => {
      const target = row.after[transition.to];
      const source = row.above[transition.from];
      switch (transition.kind) {
        case "continue":
        case "shift":
          assert.ok(source && target, `${prefix}row ${index}: ${transition.kind} leaves the graph`);
          assert.equal(source.hash, transition.hash, `${prefix}row ${index}: shift starts on the wrong line`);
          assert.equal(target.hash, transition.hash, `${prefix}row ${index}: shift ends on the wrong line`);
          assert.equal(transition.color, source.color, `${prefix}row ${index}: shift repaints its line`);
          assert.equal(transition.color, target.color, `${prefix}row ${index}: shift lands on another colour`);
          break;
        case "fork":
          assert.ok(target, `${prefix}row ${index}: fork leaves the graph`);
          assert.equal(target.hash, transition.hash, `${prefix}row ${index}: fork lands on the wrong line`);
          assert.equal(transition.color, target.color, `${prefix}row ${index}: fork repaints its line`);
          assert.ok(commit.parents.includes(transition.hash),
            `${prefix}row ${index}: fork points at ${short(transition.hash)}, not a parent`);
          break;
        case "join":
          assert.ok(source, `${prefix}row ${index}: join starts outside the graph`);
          assert.equal(source.hash, transition.hash, `${prefix}row ${index}: join starts on the wrong line`);
          assert.equal(transition.color, source.color, `${prefix}row ${index}: join repaints its line`);
          assert.equal(transition.to, lane, `${prefix}row ${index}: join misses the dot`);
          break;
        default:
          assert.fail(`${prefix}row ${index}: unknown transition ${transition.kind}`);
      }
      if (transition.kind === "fork") {
        pointedAt.set(transition.hash, (pointedAt.get(transition.hash) ?? 0) + 1);
      }
    });

    // Every parent that is in the loaded list is connected exactly once; the rest are gaps.
    const loaded = commit.parents.filter((parent) => byHash.has(parent));
    for (const parent of loaded) {
      assert.equal(pointedAt.get(parent) ?? 0, 1, `${prefix}row ${index}: parent ${short(parent)} is not connected once`);
    }
    for (const [hash, count] of pointedAt) {
      assert.equal(count, 1, `${prefix}row ${index}: ${short(hash)} connected ${count} times`);
    }
    const unloaded = commit.parents.filter((parent) => !byHash.has(parent));
    for (const parent of unloaded) {
      assert.ok(row.gaps.some((gap) => gap.hash === parent && gap.reason === "unloaded"),
        `${prefix}row ${index}: unloaded parent ${short(parent)} was not recorded as a gap`);
      // One line may run off the bottom edge for it: the commit exists in git, it is outside the
      // loaded page. Nothing may point upward at it and it may never get a dot.
      const lines = row.transitions.filter((transition) => transition.hash === parent);
      assert.ok(lines.length <= 1, `${prefix}row ${index}: unloaded parent ${short(parent)} got ${lines.length} lines`);
    }
  });

  // Geometry: distinct x per active lane, wide enough, nothing outside the rows.
  const xs = new Set();
  for (let lane = 0; lane < layout.laneCount; lane += 1) {
    const x = laneX(lane);
    assert.ok(!xs.has(x), `${prefix}lanes collide at x=${x}`);
    xs.add(x);
  }
  assert.ok(graphWidth(layout.laneCount) >= laneX(layout.laneCount - 1), `${prefix}width clips the last lane`);

  const edges = buildEdges(layout);
  const seen = new Map();
  for (const edge of edges) {
    assert.ok(LINE_COLORS.includes(edge.color), `${prefix}edge ${edge.key} is not a palette colour`);
    const previous = seen.get(edge.path);
    if (previous !== undefined) {
      assert.equal(previous, edge.color, `${prefix}${edge.path.slice(0, 30)} drawn twice in two colours`);
    }
    seen.set(edge.path, edge.color);

    const numbers = pointsOf(edge.path);
    const ys = numbers.filter((_, position) => position % 2 === 1);
    assert.ok(Math.max(...ys) <= list.length * ROW_HEIGHT, `${prefix}edge ${edge.key} is drawn outside the graph`);
    assert.ok(Math.min(...ys) >= 0, `${prefix}edge ${edge.key} is drawn above the first row`);
    // A single piece spans at most one row band; merged runs are allowed to span many rows.
    if (!edge.key.startsWith("run")) {
      assert.ok(Math.max(...ys) - Math.min(...ys) <= ROW_HEIGHT * 1.5, `${prefix}edge ${edge.key} spans several rows`);
    }
  }

  return layout;
}

test("linear history is one straight line in one colour", () => {
  const rows = [["c3", "c2"], ["c2", "c1"], ["c1"],];
  const layout = checkInvariants(rows, "linear");
  assert.deepEqual(layout.lanes, [0, 0, 0]);
  assert.deepEqual(layout.colors, [0, 0, 0]);
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
  const leaving = layout.rows[0].after;
  assert.equal(leaving.length, 2, "both parents must have a line");
  assert.notEqual(leaving[0].color, leaving[1].color, "a merge must not draw both parents in one hue");

  const fork = layout.rows[0].transitions.filter((transition) => transition.kind === "fork");
  assert.equal(fork.length, 2, "both parents fork off the merge dot");
  assert.deepEqual(new Set(fork.map((transition) => transition.hash)), new Set(["main-1", "side-1"]));
  assert.equal(layout.colors[0], fork.find((transition) => transition.to === layout.lanes[0]).color,
    "the merge dot keeps the colour of its first-parent line");
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
    assert.equal(layout.rows[index].after.filter((slot) => slot.hash === "base").length, 1,
      `row ${index} reserved base more than once`);
  }
  assert.equal(layout.rows[3].above.length, 1, "the parent arrives on a single line");
  const stubs = layout.rows.flatMap((row) =>
    row.transitions.filter((transition) =>
      transition.kind === "fork" && transition.hash === "base" && transition.from !== transition.to));
  assert.equal(stubs.length, 2, "the second and third child bend into the existing line");
});

test("several interleaved branches keep their own colours", () => {
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

  // Each chain keeps one hue from its tip to the shared root.
  for (const [tip, middle] of [["a2", "a1"], ["b2", "b1"], ["c2", "c1"]]) {
    const tipIndex = rows.findIndex(([hash]) => hash === tip);
    const line = layout.rows[tipIndex].after.find((slot) => slot.hash === middle);
    assert.ok(line, `${tip} must reserve ${middle}`);
    assert.equal(layout.colors[tipIndex], line.color, `${tip} dot must match its line`);

    // Wherever the middle commit arrives, it arrives in that same colour.
    const arrivals = layout.rows
      .flatMap((row) => row.above)
      .filter((slot) => slot.hash === middle)
      .map((slot) => slot.color);
    assert.deepEqual([...new Set(arrivals)], [line.color], `${middle} changed colour on its way down`);
  }
});

test("nested merges connect each parent to the right line", () => {
  const rows = [
    ["outer", "inner-merge", "side-b"],
    ["inner-merge", "main-1", "side-a"],
    ["main-1", "base"],
    ["side-a", "base"],
    ["side-b", "base"],
    ["base"],
  ];
  const layout = checkInvariants(rows, "nested merges");
  const outerFork = layout.rows[0].transitions.find((transition) => transition.hash === "side-b");
  const innerFork = layout.rows[1].transitions.find((transition) => transition.hash === "side-a");
  assert.ok(outerFork && innerFork, "both merges must fork their second parent");
  assert.notEqual(outerFork.color, innerFork.color, "nested merges must not share a hue");
  assert.equal(layout.rows[0].transitions.find((transition) => transition.hash === "inner-merge").kind, "fork");
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
  assert.equal(new Set(fork.map((transition) => transition.color)).size, 4, "each parent line needs its own hue");
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
  // The left root closes its lane, so the right root shifts left; its line and colour survive.
  const rightLine = layout.rows[1].after.find((slot) => slot.hash === "right-1");
  const rightRoot = layout.rows[3].above.find((slot) => slot.hash === "right-1");
  assert.ok(rightLine && rightRoot);
  assert.equal(rightRoot.color, rightLine.color, "a line changed colour when its lane shifted");
  assert.notEqual(layout.rows[1].after.indexOf(rightLine), layout.rows[3].above.indexOf(rightRoot));
});

test("a history truncated at the oldest commit records the gap instead of inventing a root", () => {
  const rows = [["newest", "middle"], ["middle", "outside-window"]];
  const layout = checkInvariants(rows, "truncated");
  assert.deepEqual(layout.rows[1].gaps, [{ hash: "outside-window", reason: "unloaded" }]);
  // The line is still drawn: the commit exists in git, it is just outside the loaded page. It runs
  // off the bottom edge rather than stopping at a fake root.
  assert.ok(layout.rows[1].after.some((slot) => slot.hash === "outside-window"));

  const edges = edgesOf(rows);
  const lowest = Math.max(...edges.map((edge) => Math.max(...pointsOf(edge.path).filter((_, position) => position % 2 === 1))));
  assert.ok(lowest <= rows.length * ROW_HEIGHT, "nothing may be drawn below the last row");
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

test("a lane that shifts left keeps its line and colour (the reported jump)", () => {
  // Three tips; the leftmost lane closes, so the two to its right each move one column left on
  // later rows. The bug reported was a line jumping 1 -> 4 -> 2 and landing on another commit.
  const rows = [
    ["left-tip", "left-base"],
    ["middle-tip", "middle-base"],
    ["right-tip", "right-base"],
    ["left-base"],
    ["middle-base", "root"],
    ["right-base", "root"],
    ["root"],
  ];
  const layout = checkInvariants(rows, "lane jump");

  const track = (hash) => {
    const seen = [];
    layout.rows.forEach((row, index) => {
      const below = row.after.findIndex((slot) => slot.hash === hash);
      if (below !== -1) seen.push({ row: index, side: "after", lane: below });
      const above = row.above.findIndex((slot) => slot.hash === hash);
      if (above !== -1) seen.push({ row: index, side: "above", lane: above });
    });
    return seen;
  };

  for (const hash of ["left-base", "middle-base", "right-base"]) {
    const trail = track(hash);
    assert.ok(trail.length >= 2, `${hash} must appear on more than one row`);
    const colour = layout.rows.flatMap((row) => [...row.above, ...row.after])
      .filter((slot) => slot.hash === hash)
      .map((slot) => slot.color);
    assert.equal(new Set(colour).size, 1, `${hash} changed colour while shifting`);
    // The lane only ever moves by one column per row band.
    for (let index = 1; index < trail.length; index += 1) {
      assert.ok(Math.abs(trail[index].lane - trail[index - 1].lane) <= 1,
        `${hash} jumped from lane ${trail[index - 1].lane} to ${trail[index].lane}`);
    }
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
  const sharedLines = layout.rows[1].after.filter((slot) => slot.hash === "shared");
  assert.equal(sharedLines.length, 1, "the merge reused the existing line");
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
  // A parent that appears above its child: not topological, so the layout must refuse the edge.
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
