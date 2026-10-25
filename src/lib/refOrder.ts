import type { CommitRef, RefType } from "../types";

const PRIORITY: RefType[] = ["stash", "branch", "tag", "remote"];

/**
 * Clean ref lists for the pills: `origin/HEAD` is noise; a local branch paired
 * with its `origin/…` twin merges into one pill rendered as "name | origin";
 * branches sort first, then tags, then other remotes.
 */
export function orderRefs(refs: CommitRef[]): CommitRef[] {
  const key = (ref: CommitRef) => `${ref.type}:${ref.name}`;
  const byKey = new Map<string, CommitRef>();

  // Locals and tags first, so remote pairing finds its branch either way.
  for (const ref of refs.filter((item) => item.type !== "remote")) {
    const existing = byKey.get(key(ref));
    if (!existing) {
      byKey.set(key(ref), ref);
      continue;
    }
    // The same ref arrives from more than one place (log decorations, for-each-ref tips), and
    // each copy knows something the other may not: the checked-out flag, the remote pairing
    // computed below. Keep both instead of letting the first one win and losing the pair.
    byKey.set(key(ref), {
      ...existing,
      ...ref,
      isCurrent: existing.isCurrent || ref.isCurrent || undefined,
      withRemote: existing.withRemote ?? ref.withRemote,
    });
  }
  for (const remote of refs.filter((item) => item.type === "remote")) {
    if (remote.name === "origin/HEAD") continue;
    // Any remote (origin, gitlab, upstream, ...) whose tip shadows a local branch pairs with it.
    const match = [...byKey.values()].find(
      (sibling) =>
        sibling.type === "branch" && remote.name.endsWith(`/${sibling.name}`),
    );
    if (match) {
      match.withRemote = remote.name.slice(0, remote.name.length - match.name.length - 1);
      continue;
    }
    if (!byKey.has(key(remote))) byKey.set(key(remote), remote);
  }
  return [...byKey.values()].sort(
    (a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type),
  );
}
