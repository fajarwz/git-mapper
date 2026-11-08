// Side choice for the uncommitted diff: the clicked side wins, an emptied side falls back.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, test, vi } from "vitest";

import { useWipSide } from "./useWipSide";
import { loadWipSide } from "../data/gitLoader";
import type { WorktreeFile } from "../lib/staging";

vi.mock("../data/gitLoader", () => ({ loadWipSide: vi.fn() }));

const row = (path: string, staged: boolean): WorktreeFile => ({
  key: `${staged ? "index" : "worktree"}:${path}`,
  path,
  status: "modified",
  additions: 1,
  deletions: 0,
  diff: [],
  staged,
  untracked: false,
});

beforeEach(() => {
  vi.mocked(loadWipSide).mockReset();
  vi.mocked(loadWipSide).mockImplementation(async (_dir, side) => [
    { path: `${side}.txt`, status: "modified", additions: 1, deletions: 0, diff: [] },
  ]);
});

function mount(rows: WorktreeFile[], active = true) {
  return renderHook((props: { rows: WorktreeFile[] }) =>
    useWipSide({ repoPath: "/r", active, rows: props.rows, digest: "d1", selectedFilePath: null }),
  { initialProps: { rows } });
}

test("a half-staged file opens on the working tree, then follows the clicked side", async () => {
  const { result } = mount([row("a.txt", true), row("a.txt", false)]);
  assert.equal(result.current.side, "unstaged");
  await waitFor(() => assert.equal(result.current.selectedFile?.path, "unstaged.txt"));

  act(() => result.current.pickSide("staged"));
  assert.equal(result.current.side, "staged");
  await waitFor(() => assert.equal(result.current.selectedFile?.path, "staged.txt"));
});

test("a side with no rows left hands over to the other one", () => {
  const { result, rerender } = mount([row("a.txt", true), row("a.txt", false)]);
  act(() => result.current.pickSide("unstaged"));
  assert.equal(result.current.side, "unstaged");
  rerender({ rows: [row("a.txt", true)] });
  assert.equal(result.current.side, "staged");
});

test("nothing is read while the uncommitted row is not on show", () => {
  mount([row("a.txt", false)], false);
  assert.equal(vi.mocked(loadWipSide).mock.calls.length, 0);
});

test("reload re-reads the side even when the digest did not move", async () => {
  const { result } = mount([row("a.txt", false)]);
  await waitFor(() => assert.equal(vi.mocked(loadWipSide).mock.calls.length, 1));
  act(() => result.current.reload());
  await waitFor(() => assert.equal(vi.mocked(loadWipSide).mock.calls.length, 2));
});
