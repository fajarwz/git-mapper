// @vitest-environment jsdom
// One integration slice through App.tsx with a mocked invoke(): open -> rows render ->
// select -> files load, plus the empty state when nothing is stored.
import assert from "node:assert/strict";
import { cleanup, render, fireEvent, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import App from "../src/App";
import { STORAGE_KEYS } from "../src/lib/persisted";
import { ROW_HEIGHT } from "../src/lib/graphGeometry";
import type { Repository } from "../src/types";

const NUL = String.fromCharCode(0);
const RS = String.fromCharCode(30);

class FakeGit {
  calls: string[] = [];
  openPath = "C:/repos/demo";
  name = "demo";
  branch = "main";
  head = "H1";
  dirty = true;
  changed = 2;
  worktree = "wt-1";
  ahead = 0;
  behind = 0;
  commits = [
    { deco: "(HEAD -> main)", hash: "H1", parents: "H2", subject: "feat: one" },
    { deco: "", hash: "H2", parents: "", subject: "feat: two" },
  ];
  stashes = "";
  files = {
    numstat: "2\t0\tnew.txt\n",
    name_status: "A\tnew.txt\n",
    diff: "diff --git a/new.txt b/new.txt\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n",
  };

  respond(op: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push(op);
    switch (op) {
      case "open_repository":
        return Promise.resolve({ path: this.openPath, name: this.name });
      case "read_status":
        return Promise.resolve({
          branch: this.branch,
          ahead: this.ahead,
          behind: this.behind,
          dirty: this.dirty,
          changed: this.changed,
          head: this.head,
          worktree: this.worktree,
        });
      case "read_log":
      case "read_log_delta": {
        const page = this.commits.slice(Number(args.skip), Number(args.skip) + Number(args.limit));
        return Promise.resolve(
          page
            .map((c) =>
              [c.deco, c.hash, "Fajar", "fajar@example.com", "2026-10-25T10:00:00+07:00", c.parents, c.subject].join(NUL) + RS + "\n",
            )
            .join(""),
        );
      }
      case "read_log_order":
        return Promise.resolve("");
      case "read_refs":
        return Promise.resolve("H1\trefs/heads/main\nH1\trefs/remotes/origin/main\n");
      case "read_stashes":
        return Promise.resolve(this.stashes);
      case "read_commit_files":
        return Promise.resolve(this.files);
      default:
        throw new Error(`FakeGit does not implement ${op}`);
    }
  }
}

let fake: FakeGit;
beforeEach(() => {
  localStorage.clear();
  // jsdom's window has no Tauri marker, so point gitLoader at the mocked invoke.
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
  // jsdom has no layout engine: the tab-shrink observer needs a stand-in.
  (window as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  fake = new FakeGit();
  vi.mocked(invoke).mockImplementation(
    (op: string, args: Record<string, unknown>) => fake.respond(op, args),
  );
});
afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
});

test("a fresh install shows the empty state and never touches git", () => {
  const { container } = render(<App />);
  assert.ok(within(container).getByText(/repository/i), "the empty state invites opening one");
  assert.equal(fake.calls.length, 0, "with no stored paths nothing reads");
  assert.equal(container.querySelectorAll("[data-commit-row]").length, 0);
});

test("a stored path hydrates rows on launch, loads wip files and shows pills", async () => {
  localStorage.setItem(STORAGE_KEYS.repos, JSON.stringify(["C:/repos/demo"]));
  const { container } = render(<App />);

  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-commit-row]").length, 3,
      "wip, then two history rows (no stashes in the fake)");
  });
  assert.ok(fake.calls.includes("open_repository"));
  assert.ok(fake.calls.includes("read_log"));
  assert.ok(fake.calls.includes("read_stashes"), "stash rows are looked up on every load");

  // The default selection is HEAD; its wip files load through read_commit_files.
  await waitFor(() => {
    assert.ok(fake.calls.includes("read_commit_files"), "the selected commit fetches its files");
  });
  await waitFor(() => {
    assert.ok(within(container).getAllByText("new.txt").length >= 2,
      "the untracked file shows in the list AND as the selected diff's header");
  });
  assert.ok(within(container).getByText("demo"), "the repo tab carries the folder name");
  assert.ok(within(container).getAllByText(/Uncommitted/).length > 0, "the uncommitted row is visible");
});

test("the search box filters the loaded rows and clears back to full history", async () => {
  localStorage.setItem(STORAGE_KEYS.repos, JSON.stringify(["C:/repos/demo"]));
  const { container } = render(<App />);

  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-commit-row]").length, 3);
  });

  const search = within(container).getByRole("textbox", { name: /search history/i });
  fireEvent.change(search, { target: { value: "two" } });

  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-commit-row]").length, 1,
      "only the matching row stays; the wip row does not match 'two'");
  });
  assert.ok(container.querySelector("[data-commit-row]")?.textContent?.includes("feat: two"));

  // Clearing through the X restores every row, wip included.
  fireEvent.click(within(container).getByRole("button", { name: /clear search/i }));
  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-commit-row]").length, 3,
      "clearing through the X restores every row, wip included");
  });
});

test("the graph svg spans every row, not just the first screen", async () => {
  localStorage.setItem(STORAGE_KEYS.repos, JSON.stringify(["C:/repos/demo"]));
  const { container } = render(<App />);

  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-commit-row]").length, 3);
  });
  const svg = container.querySelector("svg[data-commit-graph]");
  assert.ok(svg, "the graph renders");
  // The graph column clips overflow; if the svg only covered the viewport height, every node
  // below the fold would vanish on scroll.
  assert.equal(svg?.getAttribute("height"), String(3 * ROW_HEIGHT));
});

test("right-clicking a row opens the context menu with copy and checkout", async () => {
  localStorage.setItem(STORAGE_KEYS.repos, JSON.stringify(["C:/repos/demo"]));
  const { container } = render(<App />);

  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-commit-row]").length, 3);
  });
  const writeText = vi.fn().mockResolvedValue(undefined);
  (navigator as unknown as { clipboard: unknown }).clipboard = { writeText };

  // Right-click the HEAD row: it carries the checked-out main branch, so no checkout entry.
  fireEvent.contextMenu(container.querySelectorAll("[data-commit-row]")[1], {
    clientX: 30,
    clientY: 30,
  });
  const menu = within(container).getByRole("menu");
  assert.ok(within(menu).getByText("Copy commit hash"));
  assert.equal(within(menu).queryByText(/Check out/i), null,
    "the current branch is already checked out, so no checkout entry");

  fireEvent.click(within(menu).getByText("Copy commit hash"));
  assert.deepEqual(writeText.mock.calls[0], ["H1"]);
});

