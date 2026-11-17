# The commit graph, log order and stash rows

- **Graph geometry:** lines are drawn row to row, never across rows. `layoutGraph` returns, per row,
  the lanes above and below the commit plus whether the row is a tip, so `buildEdges` can draw every
  fork, join and lane shift as a bend inside that row's band, merge vertical pieces into one path
  per lane and colour, and leave tips without a line above them. Drawing a child-to-parent curve
  instead is what produced long diagonals that read as nodes jumping across the graph.
  **Colour belongs to the lane.** Lane *k* is always `laneColor(k)`, and every piece is drawn in
  the colour of the lane it ends in, so a line that moves takes the new lane's hue at the bend and
  neighbouring lanes never share one. The dot, its segments and its ref pills all use
  `laneColor(commit.lane)`, so a row and its node always match. Do not carry a colour in the line:
  a shifting line keeping its old hue is what made the graph read as broken.
  **A joining merge leaves its column empty.** When a commit joins an existing line, its own
  column is filled with `null` instead of collapsing, and the lines to its right stay put.
  Collapsing there pulled the merge's second parent into the dot's column, so the branch was
  drawn straight down in the dot's hue and looked like it never separated. The hole is reclaimed
  by the next branch tip that needs a lane. A plain (non-merge) join still collapses, as git does.
  **One line per pending commit.** A parent reserved by several children is drawn ONCE; each extra
  child records `join` and bends into that line at its own row. Reserving a lane per child drew the
  same commit as several parallel lines that fanned into one dot rows later (that was the
  `jersium-marketplace` breakage). `laneX` is not clamped: lanes past the palette still get their
  own x, and the graph width comes from `layout.laneCount`. The gutter column follows that width
  in fit mode but CAPPED at `DEFAULT_GRAPH_LANES` (six) — a lane-heavy history gets a compact
  default and the splitter widens it; a splitter drag pins an ABSOLUTE width (never an offset
  from the natural width — re-laid lanes, e.g. a search filter, would turn a stored offset
  negative, zero the column out, vanish the graph and slam the header left). A pinned column
  clips overflowing lanes on the right (`overflow-hidden`).
  **The layout records the pieces.** `layoutGraph` returns, per row, `transitions` (kind
  `continue` / `shift` / `fork` / `join`, source lane, destination lane, colour, target hash) and
  `gaps` (a parent outside the loaded window, or one already drawn because the input was not
  ordered). `buildEdges` only turns those into coordinates: it never matches hashes or guesses a
  connection. Add a test before teaching the layout a new transition kind.
- **The log is read in `--date-order`.** That promise (no parent before all of its children) is
  what the single-sweep lane allocation relies on. Plain date order can place a parent above its
  child after a clock skew; `--topo-order` is valid but groups each branch, leaving every other
  branch tip's lane open at once (406 lanes on a 400-branch repo against 11 with `--date-order`).
  `layoutGraph` reports `ordered: false` and drops such connections instead of drawing upward, with
  `gaps` saying why.
- **Stashes are their own rows, not history.** Only `refs/stash` is a ref and it points at the
  newest entry, so `for-each-ref` and `log --all` can never see the older ones: `read_stashes`
  reads the reflog (`git stash list`), and every log read passes `--exclude=refs/stash` so the
  stash commit and its `index on …` snapshot stop masquerading as commits. `stashRows` builds one
  row per entry with a `stash@{n}` pill and `stashIndex` set. Those rows are NOT pinned above
  history: `mergeStashes` hangs each one directly above the commit it was taken on (its first
  parent), so the dashed link spans one row — filing by date alone parked stashes far above
  their base, because the log's `%aI` (author) and the stash's `%cI` (committer) are different
  clocks and merged PRs keep old author dates. A base outside the loaded window still falls
  back to filing by the date the stash was taken; only the uncommitted row is pinned on top.
  They FLOAT in the layout —
  `withLanes` strips their parents, so each is a one-row tip that holds no lane down to its
  base: a stash on a months-old commit held a lane open for hundreds of rows, and one whose
  base sat outside the window traced a line to the very bottom (jersium-marketplace: 8 lanes
  became 31). `CommitGraph` still draws the link by hand — a dashed curve to the base commit's
  dot in the stash row's own branch hue, only when the base is loaded, so dot, link and pill
  match like any branch (fixed gray is the wip row's alone). They are rebuilt on every
  refresh (`stashDigest` notices a take or a drop, and a drop renumbers the survivors so the
  moved pill flashes), and are excluded from the log-order splice. The details panel
  diffs a stash against `^1`; a `stash -u` entry also needs its third parent, a parentless commit
  holding only the untracked files (`git show <hash>^3`), which `read_commit_files` appends.
  **Paging counts history rows only**: `loadMoreCommits`'s `--skip` excludes stash rows — git's
  log never contains them, so counting them skipped that many real commits per page.
