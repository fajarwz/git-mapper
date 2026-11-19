import type { Commit } from "../../../types";

/** Everything a search token is matched against, joined and lowercased once per row. */
function haystack(commit: Commit): string {
  return [
    commit.hash,
    commit.subject,
    commit.body ?? "",
    commit.author,
    commit.authorEmail,
    ...commit.refs.map((ref) => ref.name),
  ]
    .join("\n")
    .toLowerCase();
}

/** The query's tokens: lowercased, split on whitespace. Empty means "nothing is searched". */
export function queryTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((token) => token !== "");
}

/**
 * The hashes of the commits a find query matches, in list order. Space-separated tokens
 * AND together, and each one is a case-insensitive substring over the row's identity and
 * labels — hash, subject, body, author name/email and ref pill names. Not the date and not
 * the changed-file list: dates are scrolled to, files load lazily per commit, so searching
 * them costs more than it returns. A blank query matches nothing (there is nothing to
 * highlight or step through); the list itself is never filtered, so the graph keeps its lanes.
 */
export function findMatches(commits: Commit[], query: string): string[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const hits: string[] = [];
  for (const commit of commits) {
    const text = haystack(commit);
    if (tokens.every((token) => text.includes(token))) hits.push(commit.hash);
  }
  return hits;
}

export interface TextPart {
  text: string;
  /** True for the stretch a search token matched: the row paints it as a highlight. */
  hit: boolean;
}

/** Cut `text` into plain and matched stretches for the given tokens (case-insensitive). */
export function splitByTokens(text: string, tokens: string[]): TextPart[] {
  if (tokens.length === 0 || text === "") return [{ text, hit: false }];
  const pattern = new RegExp(
    [...tokens]
      .sort((a, b) => b.length - a.length)
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    "gi",
  );
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match[0] === "") continue;
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), hit: false });
    parts.push({ text: match[0], hit: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts.length > 0 ? parts : [{ text, hit: false }];
}
