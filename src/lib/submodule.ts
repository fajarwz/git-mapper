import type { DiffLine, Repository, Submodule, SubmoduleState } from "../types";

/** What a changed gitlink says: the commit it pointed at, and the one it points at now. */
export interface SubmodulePointer {
  from: string | null;
  to: string | null;
  /** The working tree of the submodule has changes of its own (git prints `-dirty`). */
  dirty: boolean;
}

const POINTER_LINE = /^Subproject commit ([0-9a-f]{7,64})(-dirty)?$/;

/**
 * A gitlink's patch is only `-Subproject commit <old>` / `+Subproject commit <new>` lines.
 * Anything else in the patch means this is an ordinary file, so it never matches by accident.
 */
export function submodulePointer(lines: DiffLine[] | null): SubmodulePointer | null {
  if (!lines) return null;
  const pointer: SubmodulePointer = { from: null, to: null, dirty: false };
  let seen = 0;
  for (const line of lines) {
    // The parser turns the patch's trailing newline into an empty context line.
    if (line.type === "hunk" || (line.type === "context" && line.text === "")) continue;
    const match = POINTER_LINE.exec(line.text);
    if (!match || line.type === "context") return null;
    if (line.type === "remove") pointer.from = match[1];
    else {
      pointer.to = match[1];
      pointer.dirty = match[2] !== undefined;
    }
    seen += 1;
  }
  return seen > 0 ? pointer : null;
}

export interface RawSubmodule {
  path: string;
  state: string;
  commit: string;
}

const STATES: ReadonlySet<string> = new Set<SubmoduleState>(["ok", "moved", "uninitialized", "conflict"]);

export function joinRepoPath(root: string, relative: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${relative}`;
}

export function shapeSubmodules(root: string, raw: RawSubmodule[]): Submodule[] {
  return raw.map((entry) => ({
    path: entry.path,
    fullPath: joinRepoPath(root, entry.path),
    name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
    state: STATES.has(entry.state) ? (entry.state as SubmoduleState) : "ok",
    commit: entry.commit,
  }));
}

/** Child repo id → parent repo id, for every open repo that is a submodule of another open one. */
export function submoduleParents(repos: Repository[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const repo of repos) {
    for (const sub of repo.submodules ?? []) parents.set(sub.fullPath, repo.id);
  }
  return parents;
}

export function sameSubmodules(a: Submodule[] | undefined, b: Submodule[]): boolean {
  const left = a ?? [];
  return (
    left.length === b.length &&
    left.every((item, index) => {
      const other = b[index];
      return item.path === other.path && item.state === other.state && item.commit === other.commit;
    })
  );
}
