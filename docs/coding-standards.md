# Coding standards

1. **Options are enums.** Any closed set of values — a status, a scope, a provider, a state or
   decision an API or CLI reports (`"SUCCESS"`, `"MERGED"`) — is a TypeScript `enum` with string
   values, never a bare string-literal union and never an inline `"literal"` compared in code.
   *Why:* one place names every option, a rename is a compiler error instead of a silent
   mismatch, `switch` and `Record<Enum, …>` over it are exhaustively checked, and a spelling the
   outside world dictates lives on exactly one line.
   *How:* `export enum PullScope { Open = "open", Merged = "merged", All = "all" }` — members
   PascalCase, **values the exact wire spelling** (what Rust, JSON or the provider sends) so no
   mapping layer is needed. Compare and key by member (`PullScope.Open`,
   `{ [PullRequestState.Open]: … }`), never by the literal. An enum for a spelling an external
   service owns (GitHub's `SUCCESS`) stays next to the parser that reads it; one the UI and the
   backend share lives in `types.ts`. At a boundary (an `invoke` payload, parsed JSON) an unknown
   value takes the `default` branch — the enum names what we know, the boundary decides what to do
   with the rest.
   *Rust side:* the same rule — an option crossing the `invoke` boundary is a Rust `enum` with
   serde (`#[serde(rename_all = "kebab-case")]`), not a `String` or `&str` compared to literals.
   *Not enums:* open-ended text (titles, branch names, search text) and booleans.
   *Mechanics:* plain `enum`, not `const enum` (`isolatedModules` is on). Code that touches an
   existing string union converts it then — like the file-size rule, not "someday". Tests build and
   compare with the members too, so a renamed option breaks the build, not just a string match.
