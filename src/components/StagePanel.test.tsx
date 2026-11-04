// The staging panel over real-shaped rows: which payload each row action emits (stage/unstage/
// discard/commit), the commit guards, and the dock affordances (× button, Esc with focus).
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { StagePanel } from "./StagePanel";
import type { WorktreeFile } from "../lib/staging";

afterEach(() => {
  cleanup();
});

const row = (over: Partial<WorktreeFile> & { path: string }): WorktreeFile => ({
  key: `worktree:${over.path}`,
  path: over.path,
  status: "modified",
  additions: 3,
  deletions: 1,
  staged: false,
  untracked: false,
  diff: [],
  ...over,
});

const FILES: WorktreeFile[] = [
  row({ key: "index:src/lib/staging.ts", path: "src/lib/staging.ts", staged: true }),
  row({ key: "index:src/components/StagePanel.tsx", path: "src/components/StagePanel.tsx", staged: true }),
  row({ key: "worktree:src/App.tsx", path: "src/App.tsx" }),
  row({ key: "worktree:fresh.txt", path: "fresh.txt", status: "added", untracked: true, additions: 4, deletions: 0 }),
];

function renderPanel(files: WorktreeFile[] = FILES, busy = false, mergeProps: {
  merging?: boolean;
  conflicts?: string[];
} = {}) {
  let stagedPaths: string[] | null = null;
  let unstagedPaths: string[] | null = null;
  let discardedPaths: string[] | null = null;
  let discardedAll = false;
  let commitMessage: string | null = null;
  let resolved: { paths: string[]; side: string } | null = null;
  let aborted = false;
  let completed = false;
  let conflictSelected: string | null = null;
  let closings = 0;
  const { container } = render(
    <StagePanel
      branch="main"
      files={files}
      busy={busy}
      merging={mergeProps.merging}
      conflicts={mergeProps.conflicts}
      onResolve={(paths, side) => (resolved = { paths, side })}
      onAbortMerge={() => (aborted = true)}
      onCompleteMerge={() => (completed = true)}
      onSelectConflict={(path) => (conflictSelected = path)}
      onStage={(paths) => (stagedPaths = paths)}
      onUnstage={(paths) => (unstagedPaths = paths)}
      onDiscard={(paths) => (discardedPaths = paths)}
      onDiscardAll={() => (discardedAll = true)}
      onCommit={(message) => (commitMessage = message)}
      onClose={() => (closings += 1)}
    />,
  );
  return {
    container,
    staged: () => stagedPaths,
    unstaged: () => unstagedPaths,
    discarded: () => discardedPaths,
    discardedAll: () => discardedAll,
    commit: () => commitMessage,
    resolved: () => resolved,
    aborted: () => aborted,
    completed: () => completed,
    completedButton: () =>
      within(container).getByTitle("Commits the resolved merge with git's own prepared message"),
    conflictSelected: () => conflictSelected,
    closings: () => closings,
  };
}

test("index and worktree sections render with their rows and the branch line", () => {
  const wrap = renderPanel();
  assert.ok(within(wrap.container).getByText("Uncommitted changes"));
  assert.ok(within(wrap.container).getByText("Staged"));
  // "2" also matches the numstat `3/1` rows' text; scope the count chip to the index section.
  const sections = within(wrap.container).getAllByText(/^(Staged|Changes)$/);
  assert.ok(sections.length === 2);
  const stagedChip = sections
    .find((el) => el.textContent === "Staged")
    ?.closest("div")
    ?.querySelector(".font-mono");
  assert.equal(stagedChip?.textContent, "2", "two index rows");
  assert.ok(within(wrap.container).getByText("main"));
  assert.ok(within(wrap.container).getByLabelText("Stage App.tsx"));
  assert.ok(within(wrap.container).getByLabelText("Unstage staging.ts"));
  // Untracked rows speak delete: their discard action says so.
  assert.ok(within(wrap.container).getByLabelText("Delete untracked fresh.txt"));
});

test("row actions emit the exact git payloads", () => {
  const wrap = renderPanel();
  fireEvent.click(within(wrap.container).getByLabelText("Stage App.tsx"));
  assert.deepEqual(wrap.staged(), ["src/App.tsx"]);

  fireEvent.click(within(wrap.container).getByLabelText("Unstage staging.ts"));
  assert.deepEqual(wrap.unstaged(), ["src/lib/staging.ts"]);

  // The × opens the confirm dialog (portaled to body); only the dialog's Discard sends the payload.
  fireEvent.click(within(wrap.container).getByLabelText("Discard changes in App.tsx"));
  assert.equal(wrap.discarded(), null, "nothing fired before the confirm");
  fireEvent.click(within(document.body).getByRole("button", { name: "Discard" }));
  assert.deepEqual(wrap.discarded(), ["src/App.tsx"]);

  fireEvent.click(within(wrap.container).getByText("Stage all"));
  assert.deepEqual(wrap.staged(), ["src/App.tsx", "fresh.txt"]);
  fireEvent.click(within(wrap.container).getByText("Unstage all"));
  assert.deepEqual(wrap.unstaged(), ["src/lib/staging.ts", "src/components/StagePanel.tsx"]);
});

test("commit emits the trimmed message only when the index has rows and a message exists", () => {
  const wrap = renderPanel();
  const message = within(wrap.container).getByLabelText("Commit message") as HTMLTextAreaElement;
  const commit = within(wrap.container).getByText("Commit") as HTMLButtonElement;

  assert.equal(commit.disabled, true, "no message yet");
  fireEvent.change(message, { target: { value: "  Add the staging rail  " } });
  fireEvent.click(commit);
  assert.equal(wrap.commit(), "Add the staging rail", "the message is trimmed");

  const empty = renderPanel(FILES.filter((file) => !file.staged));
  const emptyMessage = within(empty.container).getByLabelText("Commit message") as HTMLTextAreaElement;
  fireEvent.change(emptyMessage, { target: { value: "cannot commit" } });
  assert.equal(
    (within(empty.container).getByText("Commit") as HTMLButtonElement).disabled,
    true,
    "an empty index cannot commit",
  );
  fireEvent.click(within(empty.container).getByText("Commit"));
  assert.equal(empty.commit(), null);
});

test("busy waits the buttons; the dock affordances stay honest", () => {
  const busyWrap = renderPanel(FILES, true);
  assert.equal(
    (within(busyWrap.container).getByText("Commit") as HTMLButtonElement).disabled,
    true,
    "busy disables commit",
  );
  assert.equal(
    (within(busyWrap.container).getByText("Discard all…") as HTMLButtonElement).disabled,
    true,
    "busy disables discard-all",
  );

  const wrap = renderPanel();
  fireEvent.click(within(wrap.container).getByLabelText("Close uncommitted-changes rail"));
  assert.equal(wrap.closings(), 1);

  fireEvent.keyDown(window, { key: "Escape" });
  assert.equal(wrap.closings(), 1, "a stray Esc elsewhere leaves the rail alone");

  const message = within(wrap.container).getByLabelText("Commit message") as HTMLTextAreaElement;
  message.focus();
  fireEvent.keyDown(message, { key: "Escape" });
  assert.equal(wrap.closings(), 2, "Esc with focus inside the rail docks it");
});

test("a merge in progress renders the Conflicts section with its actions", () => {
  const wrap = renderPanel(FILES, false, { merging: true, conflicts: ["app.ts"] });

  // The conflict row lists once — the Staged/Changes sections do not echo conflicted paths
  // (App filters them out; the test starts from an App-like shape).
  assert.ok(within(wrap.container).getByText("Conflicts"));
  assert.ok(within(wrap.container).getByLabelText("Take ours for app.ts"));
  assert.ok(within(wrap.container).getByLabelText("Take theirs for app.ts"));
  const commitButton = within(wrap.container).getByText("Commit") as HTMLButtonElement;
  assert.equal(commitButton.disabled, true, "a merge in progress reserves the commit button");
  const complete = within(wrap.container).getByText("Complete merge") as HTMLButtonElement;
  assert.ok(complete, "completing is the footer's second button during a merge");

  // Sides resolve one-by-one; the row click summons the conflict view.
  fireEvent.click(within(wrap.container).getByLabelText("Take theirs for app.ts"));
  assert.deepEqual(wrap.resolved(), { paths: ["app.ts"], side: "theirs" });
  fireEvent.click(within(wrap.container).getByText("app.ts"));
  assert.equal(wrap.conflictSelected(), "app.ts");

  // Abort asks first — the dialog's own button carries the payload.
  fireEvent.click(within(wrap.container).getByText("Abort merge…"));
  assert.equal(wrap.aborted(), false, "nothing fired before the confirm");
  fireEvent.click(within(document.body).getByRole("button", { name: "Abort merge" }));
  assert.equal(wrap.aborted(), true);

  // A merge with everything staged reads resolved and the merge completes from the footer.
  const stagedFile = row({ key: "index:app.ts", path: "app.ts", staged: true });
  const settled = renderPanel([stagedFile], false, { merging: true, conflicts: ["app.ts"] });
  assert.ok(within(settled.container).getByText("resolved"));
  fireEvent.click(settled.completedButton());
  assert.equal(settled.completed(), true, "the resolved merge completes from the footer");
});

test("without a merge nothing of the resolver appears", () => {
  const wrap = renderPanel();
  assert.throws(() => within(wrap.container).getByText("Complete merge"));
});
