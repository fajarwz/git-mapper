/**
 * Git Graph-style layout: branch tracing with stable colours and smooth curves.
 *
 * Each commit is a vertex. Starting from every vertex that still needs a branch or still has
 * parents to follow, we trace a path down the DAG, creating a Branch. A branch keeps its colour
 * from its first commit to its last, so a line that changes horizontal lane still keeps its hue
 * (the defining visual trait of vscode-git-graph).
 *
 * x-coordinates are allocated densely with an availability counter per vertex (`nextX`), so a lane
 * is reclaimed as soon as the branch that used it ends. The first-parent chain of each branch stays
 * on the leftmost available lane, which keeps the main history straight and pushes feature branches
 * to the right.
 */
export const LINE_COLOR_COUNT = 8;

export interface LaneGap {
  hash: string;
  reason: "unloaded" | "out-of-order";
}

export interface GraphPoint {
  x: number;
  y: number;
}

export interface BranchLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  committed: boolean;
}

export interface BranchPath {
  color: number;
  lines: BranchLine[];
}

export interface GraphLayout {
  /** Horizontal lane index of each commit's dot. */
  lanes: number[];
  /** Branch-colour index of each commit's dot. */
  branchColors: number[];
  /** One path per branch, already in draw order. */
  branches: BranchPath[];
  /** Lanes needed at the widest row, for the SVG width. */
  laneCount: number;
  /** False when a parent appeared above its child (input was not newest-first topological). */
  ordered: boolean;
  /** Parents that sit outside the loaded window or above their child. */
  gaps: LaneGap[];
}

class Branch {
  public end = 0;
  constructor(
    public readonly color: number,
    public readonly lines: BranchLine[] = [],
  ) {}

  addLine(x1: number, y1: number, x2: number, y2: number, committed: boolean) {
    this.lines.push({ x1, y1, x2, y2, committed });
  }
}

class Vertex {
  public x = 0;
  public branch: Branch | null = null;
  public nextParentIndex = 0;
  public nextX = 0;
  public committed = true;
  public readonly children: Vertex[] = [];
  public readonly parents: (Vertex | null)[] = [];

  constructor(
    public readonly id: number,
    public readonly hash: string,
  ) {}

  nextParent(): Vertex | null {
    while (this.nextParentIndex < this.parents.length) {
      const p = this.parents[this.nextParentIndex];
      if (p !== null) return p;
      this.nextParentIndex++;
    }
    return null;
  }

  registerParentProcessed() {
    this.nextParentIndex++;
  }

  isMerge() {
    return this.parents.length > 1;
  }

  addToBranch(branch: Branch, x: number) {
    if (this.branch === null) {
      this.branch = branch;
      this.x = x;
    }
  }

  point(): GraphPoint {
    return { x: this.x, y: this.id };
  }

  nextPoint(): GraphPoint {
    return { x: this.nextX, y: this.id };
  }

  registerUnavailablePoint(x: number) {
    if (x === this.nextX) {
      this.nextX = x + 1;
    }
  }
}

const NULL_VERTEX = new Vertex(-1, "");

export function layoutGraph(
  commits: Array<{ hash: string; parents: string[]; uncommitted?: boolean }>,
): GraphLayout {
  const n = commits.length;
  const indexByHash = new Map(commits.map((c, i) => [c.hash, i]));

  const vertices = commits.map((c, i) => {
    const v = new Vertex(i, c.hash);
    if (c.uncommitted) v.committed = false;
    return v;
  });

  const gaps: LaneGap[] = [];
  let ordered = true;

  for (let i = 0; i < n; i++) {
    for (const parentHash of commits[i].parents) {
      const parentIndex = indexByHash.get(parentHash);
      if (parentIndex === undefined) {
        vertices[i].parents.push(NULL_VERTEX);
        gaps.push({ hash: parentHash, reason: "unloaded" });
      } else {
        if (parentIndex < i) ordered = false;
        vertices[i].parents.push(vertices[parentIndex]);
        vertices[parentIndex].children.push(vertices[i]);
      }
    }
  }

  const branches: Branch[] = [];
  const availableColours: number[] = [];
  let laneCount = 1;

  function getAvailableColour(startAt: number): number {
    for (let i = 0; i < availableColours.length; i++) {
      if (startAt > availableColours[i]) return i;
    }
    availableColours.push(0);
    return availableColours.length - 1;
  }

  function determinePath(startAt: number) {
    let i = startAt;
    let vertex = vertices[i];
    let parentVertex = vertex.nextParent();
    let lastPoint = vertex.branch === null ? vertex.nextPoint() : vertex.point();

    laneCount = Math.max(laneCount, lastPoint.x + 1);

    if (
      parentVertex !== null &&
      parentVertex.id !== -1 &&
      vertex.isMerge() &&
      vertex.branch !== null &&
      parentVertex.branch !== null
    ) {
      // The merge's second parent is already on another branch: trace a connecting path
      // from this vertex down to that parent, reusing the parent's branch colour.
      const parentBranch = parentVertex.branch;
      let foundPointToParent = false;
      for (i = startAt + 1; i < n; i++) {
        const curVertex = vertices[i];
        // If the current vertex is the target parent, land on its existing point.
        const curPoint = curVertex === parentVertex ? parentVertex.point() : curVertex.nextPoint();
        if (curVertex === parentVertex) foundPointToParent = true;

        parentBranch.addLine(
          lastPoint.x,
          lastPoint.y,
          curPoint.x,
          curPoint.y,
          vertex.committed,
        );
        curVertex.registerUnavailablePoint(curPoint.x);
        laneCount = Math.max(laneCount, curPoint.x + 1);
        lastPoint = curPoint;

        if (foundPointToParent) {
          vertex.registerParentProcessed();
          break;
        }
      }
    } else {
      const branch = new Branch(getAvailableColour(startAt));
      vertex.addToBranch(branch, lastPoint.x);
      vertex.registerUnavailablePoint(lastPoint.x);

      for (i = startAt + 1; i < n; i++) {
        const curVertex = vertices[i];
        const curPoint =
          parentVertex === curVertex && parentVertex.branch !== null
            ? curVertex.point()
            : curVertex.nextPoint();

        branch.addLine(lastPoint.x, lastPoint.y, curPoint.x, curPoint.y, vertex.committed);
        curVertex.registerUnavailablePoint(curPoint.x);
        laneCount = Math.max(laneCount, curPoint.x + 1);
        lastPoint = curPoint;

        if (parentVertex === curVertex) {
          vertex.registerParentProcessed();
          const parentVertexOnBranch = parentVertex.branch !== null;
          parentVertex.addToBranch(branch, curPoint.x);
          vertex = parentVertex;
          parentVertex = vertex.nextParent();
          if (parentVertex === null || parentVertexOnBranch) {
            break;
          }
        }
      }

      if (i === n && parentVertex !== null && parentVertex.id === -1) {
        // Parent is outside the loaded window; mark the edge as handled.
        vertex.registerParentProcessed();
      }

      branch.end = i;
      branches.push(branch);
      availableColours[branch.color] = i;
    }
  }

  let i = 0;
  while (i < n) {
    if (vertices[i].nextParent() !== null || vertices[i].branch === null) {
      determinePath(i);
    } else {
      i++;
    }
  }

  const lanes = vertices.map((v) => v.x);
  const branchColors = vertices.map((v) => v.branch?.color ?? 0);

  return { lanes, branchColors, branches, laneCount, ordered, gaps };
}
