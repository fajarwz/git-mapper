import type { Commit } from "../types";

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

/**
 * Filter commits by a free-text query, the way the title-bar search box means it:
 * space-separated tokens AND together, and each one is a case-insensitive substring
 * over the row's identity and labels — short hash, subject, body, author name/email
 * and ref pill names. Not the date and not the changed-file list: dates are scrolled
 * to, files load lazily per commit, so searching them costs more than it returns.
 * An empty or blank query returns the input array itself, so memoized callers see no
 * change and unchanged rows keep object identity.
 */
export function filterCommits(commits: Commit[], query: string): Commit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter((token) => token !== "");
  if (tokens.length === 0) return commits;
  return commits.filter((commit) => {
    const text = haystack(commit);
    return tokens.every((token) => text.includes(token));
  });
}
