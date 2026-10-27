// @vitest-environment jsdom
// One integration slice through App.tsx with a mocked invoke(): open -> rows render ->
// select -> files load, plus the empty state when nothing is stored.
import assert from "node:assert/strict";
import { cleanup, render, fireEvent, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import App from "../src/App";
import { SLEEP_AFTER_MS, SLEEP_TICK_MS } from "../src/data/gitLoader";
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
    numstat: "2\t0\tnew.txt\n1\t1\tsecond.txt\n",
    name_status: "A\tnew.txt\nM\tsecond.txt\n",
    diff:
      "diff --git a/new.txt b/new.txt\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n" +
      "diff --git a/second.txt b/second.txt\n--- a/second.txt\n+++ b/second.txt\n@@ -1,1 +1,1 @@\n-old\n+new\n",
  };

  respond(op: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push(op);
    switch (op) {
      case "open_repository":
        // Echo the requested dir so several tabs get distinct ids (id === path).
        return Promise.resolve({
          path: (args.dir as string) ?? this.openPath,
          name: ((args.dir as string) ?? this.openPath).split("/").pop() ?? this.name,
        });
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
      case "pull_branch":
        this.calls.push("pull_branch:ran");
        return Promise.resolve("");
      case "push_branch":
        this.calls.push("push_branch:ran");
        return Promise.resolve("");
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

test("a launch with saved tabs boots instead of flashing the open-folder card", () => {
  localStorage.setItem(STORAGE_KEYS.repos, JSON.stringify(["C:/repos/demo"]));
  // Hold the very first read open: that is the window the launch screen has to cover.
  vi.mocked(invoke).mockImplementation((op: string, args: Record<string, unknown>) =>
    op === "open_repository" ? new Promise(() => {}) : fake.respond(op, args),
  );

  const { container } = render(<App />);

  assert.ok(container.querySelector("[data-boot-screen]"), "the launch screen is up");
  assert.equal(
    within(container).queryByText("Open a Git repository"),
    null,
    "the empty state never paints while saved tabs are still loading",
  );
});

test("a stored path hydrates rows on launch, loads wip files and shows pills", async () => {
  localStorage.setItem(STORAGE_KEYS.repos, JSON.stringify(["C:/repos/demo"]));
  const { container } = render(<App />);

  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-commit-row]").length, 3,
      "wip, then two history rows (no stashes in the fake)");
  });
  assert.equal(container.querySelector("[data-boot-screen]"), null, "the launch screen is gone");
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

test("the diff scope toggle stacks every file and is remembered", async () => {
  localStorage.setItem(STORAGE_KEYS.repos, JSON.stringify(["C:/repos/demo"]));
  const { container } = render(<App />);
  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-commit-row]").length, 3);
  });
  await waitFor(() => {
    assert.ok(container.querySelector("[data-diff-line]"), "the selected file's diff is up");
  });

  assert.equal(
    container.querySelectorAll("[data-diff-file]").length,
    0,
    "the default scope shows one file at a time",
  );

  fireEvent.click(container.querySelector("[data-diff-scope='all']") as HTMLElement);

  await waitFor(() => {
    assert.equal(
      container.querySelectorAll("[data-diff-file]").length,
      2,
      "the wip payload's files are stacked in the single-scroll view",
    );
  });
  assert.equal(
    localStorage.getItem(STORAGE_KEYS.diffScope),
    JSON.stringify("all"),
    "the choice survives the next launch",
  );
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

test("the pull button runs the git pull and refreshes", async () => {
  localStorage.setItem(STORAGE_KEYS.repos, JSON.stringify(["C:/repos/demo"]));
  const { container } = render(<App />);

  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-commit-row]").length, 3);
  });

  fireEvent.click(within(container).getByRole("button", { name: "Pull main" }));

  await waitFor(() => {
    assert.ok(fake.calls.includes("pull_branch:ran"), "the git pull ran through the backend");
    assert.ok(fake.calls.includes("read_status"), "a sync ends with a forced refresh");
  });
});

test("clicking a file in the list previews that file, not the previous one", async () => {
  localStorage.setItem(STORAGE_KEYS.repos, JSON.stringify(["C:/repos/demo"]));
  const { container } = render(<App />);
  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-file-item]").length, 2, "both changed files list");
  });

  const rows = [...container.querySelectorAll("[data-file-item]")];
  const second = rows.find((row) => row.textContent?.includes("second.txt")) as HTMLElement;
  fireEvent.click(second);

  await waitFor(() => {
    const header = container.querySelector("[data-diff] > div")?.textContent ?? "";
    assert.ok(header.includes("second.txt"), "the diff pane switched to the clicked file");
    assert.ok(!header.includes("new.txt"), "the previously selected file is gone from the pane");
  });
  assert.equal(
    second.getAttribute("data-selected"),
    "true",
    "the clicked row carries the selection",
  );
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

test("opening a folder that is not a git repository shows a toast, repo open or not", async () => {
  localStorage.setItem(STORAGE_KEYS.repos, JSON.stringify(["C:/repos/demo"]));
  const { container } = render(<App />);
  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-commit-row]").length, 3);
  });

  // The folder picker resolves to a path — plugin-dialog calls the RAW window internals, not the
  // mocked core module — and the backend then refuses like a non-git folder does.
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: (op: string) =>
      op === "plugin:dialog|open" ? Promise.resolve("C:/some/plain-folder") : Promise.resolve(null),
  };
  vi.mocked(invoke).mockImplementation((op: string, args: Record<string, unknown>) =>
    op === "open_repository"
      ? Promise.reject(new Error("C:/some/plain-folder is not a Git repository"))
      : fake.respond(op, args),
  );
  fireEvent.click(within(container).getByRole("button", { name: "Open repository" }));

  await waitFor(() => {
    const toast = container.querySelector("[data-toast]");
    assert.ok(toast, "the failure toast is up even though a repo is open");
    assert.ok(toast?.textContent?.includes("Could not open that folder"));
    assert.ok(toast?.textContent?.includes("is not a Git repository"), "git's message rides along");
  });
  assert.equal(
    container.querySelectorAll("[data-commit-row]").length,
    3,
    "the already-open repository is untouched",
  );
});

test("saved tabs that no longer open are announced instead of vanishing", async () => {
  localStorage.setItem(STORAGE_KEYS.repos, JSON.stringify(["C:/repos/gone", "C:/repos/demo"]));
  vi.mocked(invoke).mockImplementation((op: string, args: Record<string, unknown>) =>
    op === "open_repository" && args.dir === "C:/repos/gone"
      ? Promise.reject(new Error("C:/repos/gone is not a Git repository"))
      : fake.respond(op, args),
  );

  const { container } = render(<App />);
  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-commit-row]").length, 3, "the good tab loads");
  });
  const toast = container.querySelector("[data-toast]");
  assert.ok(toast, "the failed tab gets a notice");
  assert.ok(toast?.textContent?.includes("A saved repository could not be reopened"));
  assert.ok(toast?.textContent?.includes("C:/repos/gone"));
});

test("an inactive tab sleeps after five minutes and reloads when clicked", async () => {
  localStorage.setItem(STORAGE_KEYS.repos, JSON.stringify(["C:/repos/demo", "C:/repos/other"]));
  // Fake timers go up BEFORE render: the sleep interval arms at mount, so it must be created
  // on the faked clock for advanceTimersByTimeAsync to reach it.
  vi.useFakeTimers();
  vi.setSystemTime(new Date());
  const { container } = render(<App />);
  const flush = async () => {
    for (let i = 0; i < 50 && container.querySelectorAll("[data-commit-row]").length === 0; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }
  };
  await flush();
  assert.equal(container.querySelectorAll("[data-commit-row]").length, 3, "the active tab loads");

  await vi.advanceTimersByTimeAsync(SLEEP_AFTER_MS + SLEEP_TICK_MS);
  const sleepingTab = container.querySelector('[data-sleeping="true"]');
  assert.ok(sleepingTab, "the inactive tab is marked as sleeping");
  assert.equal(sleepingTab?.getAttribute("data-tab-id"), "C:/repos/other");

  vi.useRealTimers();
  fireEvent.click(within(container).getByRole("tab", { name: "other" }));
  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-commit-row]").length, 3, "the tab reloaded");
  });
  const wakeReads = vi
    .mocked(invoke)
    .mock.calls.filter(
      ([op, args]) => op === "read_log" && (args as Record<string, unknown>).dir === "C:/repos/other",
    );
  assert.ok(wakeReads.length > 0, "waking re-read the sleeping tab's history");
});

