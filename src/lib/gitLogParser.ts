import type { CommitRef } from "../types";

const FIELD = "\x00";
const RECORD = "\x1e";

export interface LogCommit {
  hash: string;
  author: string;
  authorEmail: string;
  date: string;
  parents: string[];
  subject: string;
  body: string;
  refs: CommitRef[];
}

export function parseRefs(deco: string): CommitRef[] {
  const inner = deco.trim().replace(/^\((.*)\)$/, "$1");
  if (!inner) return [];
  // Decorations only ever carry branch tips and tags (remotes come from
  // for-each-ref, loadRepository merges them); slashed names are just local
  // branches like fix/x — the old "slash = remote" guess produced ghost pills.
  return inner
    .split(", ")
    .filter((entry) => !/\//.test(entry.replace(/^HEAD -> /, "")))
    .map<CommitRef>((entry) => {
      if (entry.startsWith("tag: ")) {
        return { type: "tag", name: entry.slice(5) };
      }
      // Decorations never say which branch is checked out besides HEAD ->;
      // read_status decides that in the loader.
      const isCurrent = entry.startsWith("HEAD -> ");
      const name = entry.slice(isCurrent ? 8 : 0);
      return { type: "branch", name, isCurrent: isCurrent || undefined };
    });
}

export function parseLog(raw: string): LogCommit[] {
  const out: LogCommit[] = [];
  for (const record of raw.split(RECORD)) {
    const clean = record.replace(/\n$/, "");
    if (!clean.trim() || clean.trim() === "\n" || clean.trim() === "") continue;
    const fields = clean.split(FIELD);
    if (fields.length < 7) continue;
    const [deco, hash, author, authorEmail, date, parents, body] = fields;
    const bodyLines = body.split("\n");
    if (hash.trim() === "" || bodyLines[0] === undefined) continue;
    out.push({
      hash,
      author,
      authorEmail,
      date,
      parents: parents ? parents.split(" ").filter(Boolean) : [],
      subject: bodyLines[0],
      body: bodyLines.slice(1).join("\n").trim(),
      refs: parseRefs(deco),
    });
  }
  return out;
}
