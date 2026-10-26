// The diff panel: bare tokens, signs in their own cell, status labels.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, render, within, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, test, vi } from "vitest";

import { DiffViewer } from "./DiffViewer";
import { loadImageVersions } from "../data/gitLoader";
import type { ChangedFile } from "../types";

// The picture diff talks to the backend through gitLoader; give it canned blobs per test.
vi.mock("../data/gitLoader", () => ({ loadImageVersions: vi.fn() }));

// Grammar loading is real, except the css grammar can be held open by a test that needs the
// "new file's tokens have not arrived yet" window to last.
const highlightState = vi.hoisted(() => ({ blockCss: false }));
vi.mock("../lib/highlight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/highlight")>();
  return {
    ...actual,
    loadHighlighter: (language: string) =>
      language === "css" && highlightState.blockCss
        ? new Promise<never>(() => {})
        : actual.loadHighlighter(language),
  };
});

beforeEach(() => {
  vi.mocked(loadImageVersions).mockReset();
  highlightState.blockCss = false;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

const sampleFile: ChangedFile = {
  path: "src/app.tsx",
  status: "modified",
  additions: 2,
  deletions: 1,
  diff: [
    { type: "hunk", text: "@@ -1,2 +1,3 @@" },
    { type: "context", text: "kept" },
    { type: "add", text: "came" },
    { type: "remove", text: "gone" },
  ],
};

test("DiffViewer without a file asks for a selection", () => {
  const { container } = render(
    <DiffViewer files={[]} file={null} scope="file" onScopeChange={() => {}} scheme="app" />,
  );
  assert.ok(within(container).getByText("Select a changed file to see its diff."));
});

test("DiffViewer renders bare text with the sign in its own cell", () => {
  const { container } = render(
    <DiffViewer
      files={[sampleFile]}
      file={sampleFile}
      scope="file"
      onScopeChange={() => {}}
      scheme="app"
    />,
  );
  assert.ok(within(container).getByText("src/app.tsx"));
  assert.ok(within(container).getByText("Modified"));
  assert.ok(within(container).getByText("+2"));
  assert.ok(within(container).getByText("−1"));
  const rows = [...container.querySelectorAll("[data-diff-line]")];
  const contextRow = rows.find((row) => row.getAttribute("data-diff-line") === "context");
  assert.ok(
    contextRow?.firstElementChild?.className.includes("text-ink/45"),
    "gutters are muted gray like GitHub's, clearly fainter than the code",
  );
  assert.deepEqual(
    rows.map((row) =>
      row.getAttribute("data-diff-line") === "hunk"
        ? ["hunk", row.textContent]
        : [row.getAttribute("data-diff-line") ?? "", ...[...row.children].map((cell) => cell.textContent)],
    ),
    [
      ["hunk", "@@ -1,2 +1,3 @@"],
      ["context", "1", "1", " ", "kept"],
      ["add", "", "2", "+", "came"],
      ["remove", "2", "", "-", "gone"],
    ],
    "content cells keep bare text; old/new gutters number from the hunk header",
  );
});

test("add and remove line gutters use the line tone, context stays muted", () => {
  const { container } = render(
    <DiffViewer
      files={[sampleFile]}
      file={sampleFile}
      scope="file"
      onScopeChange={() => {}}
      scheme="app"
    />,
  );
  const rows = [...container.querySelectorAll("[data-diff-line]")];
  const addRow = rows.find((row) => row.getAttribute("data-diff-line") === "add");
  const removeRow = rows.find((row) => row.getAttribute("data-diff-line") === "remove");
  const contextRow = rows.find((row) => row.getAttribute("data-diff-line") === "context");

  const oldGutter = (row: Element) => row.children[0]?.className ?? "";
  const newGutter = (row: Element) => row.children[1]?.className ?? "";

  assert.ok(oldGutter(removeRow!).includes("text-danger-ink"), "remove line's old number is danger ink");
  assert.ok(newGutter(addRow!).includes("text-success-ink"), "add line's new number is success ink");
  assert.ok(oldGutter(addRow!).includes("text-ink/45"), "add line's empty old gutter stays muted");
  assert.ok(newGutter(removeRow!).includes("text-ink/45"), "remove line's empty new gutter stays muted");
  assert.ok(oldGutter(contextRow!).includes("text-ink/45"), "context old gutter stays muted");
  assert.ok(newGutter(contextRow!).includes("text-ink/45"), "context new gutter stays muted");
});

test("DiffViewer tokenizes the content once the grammar loads", async () => {
  const tsFile: ChangedFile = {
    path: "src/index.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    diff: [{ type: "add", text: "const answer = 42;" }],
  };
  const { container } = render(
    <DiffViewer files={[tsFile]} file={tsFile} scope="file" onScopeChange={() => {}} scheme="neon" />,
  );
  await waitFor(() => {
    assert.ok(container.querySelector(".hljs-keyword"), "const is tokenized");
  });
  assert.ok(container.querySelector("[data-syntax='neon']"), "the palette scope is on the panel");
  const row = container.querySelector("[data-diff-line='add']")?.textContent ?? "";
  assert.ok(row.includes("const answer = 42;"),
    "token spans live inside the content cell; the row text is unchanged");
});

const secondFile: ChangedFile = {
  path: "README.md",
  status: "added",
  additions: 1,
  deletions: 0,
  diff: [{ type: "add", text: "# hi" }],
};

test("the all-files scope stacks every file under its own sticky header", () => {
  const { container } = render(
    <DiffViewer
      files={[sampleFile, secondFile]}
      file={sampleFile}
      scope="all"
      onScopeChange={() => {}}
      scheme="app"
    />,
  );

  const sections = [...container.querySelectorAll("[data-diff-file]")];
  assert.deepEqual(
    sections.map((section) => section.getAttribute("data-diff-file")),
    ["src/app.tsx", "README.md"],
    "every changed file is on the page at once, in order",
  );
  assert.equal(
    container.querySelectorAll("[data-diff-line]").length,
    5,
    "the second file's lines are mounted too, with no click",
  );
  assert.ok(
    sections[0].firstElementChild?.className.includes("sticky"),
    "each file header sticks while its lines scroll past",
  );

  const header = container.querySelector("[data-diff] > div")?.textContent ?? "";
  assert.ok(header.includes("2 files changed"));
  assert.ok(header.includes("+3"), "the header totals every file, not the selected one");
  assert.ok(header.includes("−1"));
});

test("the scope toggle reports the clicked side and marks the active one", () => {
  const picked: string[] = [];
  const { container } = render(
    <DiffViewer
      files={[sampleFile]}
      file={sampleFile}
      scope="file"
      onScopeChange={(next) => picked.push(next)}
    />,
  );

  const one = container.querySelector("[data-diff-scope='file']");
  const all = container.querySelector("[data-diff-scope='all']");
  assert.equal(one?.getAttribute("aria-pressed"), "true");
  assert.equal(all?.getAttribute("aria-pressed"), "false");

  fireEvent.click(all as HTMLElement);
  assert.deepEqual(picked, ["all"], "the click asks the owner to change scope; it does not keep it");
});

test("split layout pairs old and new side by side, hunk spanning both panes", () => {
  const { container } = render(
    <DiffViewer
      files={[sampleFile]}
      file={sampleFile}
      scope="file"
      onScopeChange={() => {}}
      layout="split"
      onLayoutChange={() => {}}
      scheme="app"
    />,
  );

  assert.ok(container.querySelector("[data-diff-row='hunk']"), "the hunk header is its own row");
  const oldCells = [...container.querySelectorAll("[data-diff-code='old']")];
  const newCells = [...container.querySelectorAll("[data-diff-code='new']")];
  assert.deepEqual(
    oldCells.map((cell) => cell.textContent),
    ["kept", "gone"],
    "the left pane carries context and removes",
  );
  assert.deepEqual(
    newCells.map((cell) => cell.textContent),
    ["kept", "came"],
    "the right pane carries context and adds; the change block zips into one row",
  );
  const oldNums = [...container.querySelectorAll("[data-diff-num='old']")];
  const newNums = [...container.querySelectorAll("[data-diff-num='new']")];
  assert.deepEqual(oldNums.map((cell) => cell.textContent), ["1", "2"]);
  assert.deepEqual(newNums.map((cell) => cell.textContent), ["1", "2"]);
});

test("split layout leaves the old pane blank for an added file's lines", () => {
  const { container } = render(
    <DiffViewer
      files={[secondFile]}
      file={secondFile}
      scope="file"
      onScopeChange={() => {}}
      layout="split"
      onLayoutChange={() => {}}
      scheme="app"
    />,
  );

  const emptyOld = container.querySelector("[data-diff-code='old'][data-diff-line='empty']");
  assert.ok(emptyOld, "a pure addition gets blank cells, not a shifted grid");
  assert.equal(emptyOld?.textContent, " ");
  assert.ok(emptyOld?.className.includes("bg-ink"), "the void side carries the neutral wash, not bare sheet");
  assert.ok(
    container.querySelector("[data-diff-num='old']")?.className.includes("bg-ink"),
    "the void gutter is tinted with its cell",
  );
  const newCell = container.querySelector("[data-diff-code='new']");
  assert.equal(newCell?.textContent, "# hi");
});

test("the layout toggle reports the clicked side and marks the active one", () => {
  const picked: string[] = [];
  const { container } = render(
    <DiffViewer
      files={[sampleFile]}
      file={sampleFile}
      scope="file"
      onScopeChange={() => {}}
      layout="unified"
      onLayoutChange={(next) => picked.push(next)}
    />,
  );

  const unified = container.querySelector("[data-diff-layout='unified']");
  const split = container.querySelector("[data-diff-layout='split']");
  assert.equal(unified?.getAttribute("aria-pressed"), "true");
  assert.equal(split?.getAttribute("aria-pressed"), "false");

  fireEvent.click(split as HTMLElement);
  assert.deepEqual(picked, ["split"], "the click asks the owner to change layout");
});

test("long lines wrap by default; the wrap toggle asks the owner to switch", () => {
  const picked: boolean[] = [];
  const { container } = render(
    <DiffViewer
      files={[sampleFile]}
      file={sampleFile}
      scope="file"
      onScopeChange={() => {}}
      onWrapChange={(next) => picked.push(next)}
    />,
  );

  const row = container.querySelector("[data-diff-line='context']");
  assert.ok(row, "the unified row is on the page");
  assert.ok(!row.className.includes("w-max"), "wrapped rows give up max-content width");
  assert.ok(container.querySelector(".whitespace-pre-wrap"), "content cells soft-wrap");

  const button = container.querySelector("[data-diff-wrap]");
  assert.equal(button?.getAttribute("aria-pressed"), "true");
  fireEvent.click(button as HTMLElement);
  assert.deepEqual(picked, [false], "the click asks the owner to turn wrapping off");
});

test("wrap off restores the scrollable max-content rows", () => {
  const { container } = render(
    <DiffViewer
      files={[sampleFile]}
      file={sampleFile}
      scope="file"
      onScopeChange={() => {}}
      wrap={false}
      onWrapChange={() => {}}
    />,
  );

  const row = container.querySelector("[data-diff-line='context']");
  assert.ok(row?.className.includes("w-max"), "rows size to their longest line again");
  assert.equal(container.querySelector(".whitespace-pre-wrap"), null, "nothing soft-wraps");
});

const imageFile: ChangedFile = {
  path: "screenshots/app.png",
  status: "modified",
  additions: 0,
  deletions: 0,
  diff: [],
};

const withImage = (file: ChangedFile, repoPath?: string, commitHash?: string) =>
  render(
    <DiffViewer
      files={[file]}
      file={file}
      scope="file"
      onScopeChange={() => {}}
      scheme="app"
      repoPath={repoPath}
      commitHash={commitHash}
    />,
  );

const png = (size: number) => ({
  url: "data:image/png;base64,iVBORw0KGgo=",
  bytes: size,
  tooLarge: false,
});

test("an image file renders the 2-up picture diff with both versions", async () => {
  vi.mocked(loadImageVersions).mockResolvedValue({
    previous: png(1024),
    current: png(2048),
  });
  const { container } = withImage(imageFile, "C:/repo", "abc123");

  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-image-side]").length, 2);
  });
  assert.ok(within(container).getByText("Previous"));
  assert.ok(within(container).getByText("Current"));
  const images = [...container.querySelectorAll("[data-image-src]")];
  assert.deepEqual(
    images.map((img) => img.getAttribute("data-image-src")),
    ["previous", "current"],
    "each side renders its own copy",
  );
  assert.ok(
    images[0].getAttribute("src")?.startsWith("data:image/png;base64,"),
    "the blob arrives as a data URL, not a path",
  );
  const previousCaption =
    container.querySelector("[data-image-side='previous'] figcaption")?.textContent ?? "";
  const currentCaption =
    container.querySelector("[data-image-side='current'] figcaption")?.textContent ?? "";
  assert.ok(previousCaption.includes("1 KB"), "the previous side shows its size");
  assert.ok(currentCaption.includes("2 KB"), "the current side shows its size");
  assert.ok(container.querySelector("[data-image-mode='2up']"), "mode switch only with two copies");
  assert.equal(vi.mocked(loadImageVersions).mock.calls.length, 1, "one read per image file");
});

test("an added image has no previous copy and no mode switch", async () => {
  vi.mocked(loadImageVersions).mockResolvedValue({ previous: null, current: png(300) });
  const { container } = withImage({ ...imageFile, status: "added" }, "C:/repo", "abc123");

  await waitFor(() => {
    assert.equal(container.querySelectorAll("[data-image-side]").length, 1);
  });
  const pane = container.querySelector("[data-image-side='current']") as HTMLElement;
  assert.ok(within(pane).getByText("Added"), "the lone pane is labeled as an addition");
  assert.equal(container.querySelector("[data-image-mode]"), null, "one side, nothing to switch");
});

test("swipe mode overlays the copies with a draggable clip", async () => {
  vi.mocked(loadImageVersions).mockResolvedValue({ previous: png(64), current: png(128) });
  const { container } = withImage(imageFile, "C:/repo", "abc123");
  await waitFor(() => {
    assert.ok(container.querySelector("[data-image-mode='swipe']"));
  });

  fireEvent.click(container.querySelector("[data-image-mode='swipe']") as HTMLElement);
  const strip = container.querySelector("[data-image-diff='swipe']");
  assert.ok(strip, "the strip replaces the 2-up grid");
  const current = container.querySelector("[data-image-src='current']") as HTMLElement;
  assert.match(current.style.clipPath, /inset\(0 50% 0 0\)/, "the current copy clips at the divider");
  assert.ok(container.querySelector("[data-image-divider]"), "the divider sits at the same spot");

  const slider = container.querySelector("[data-image-slider]") as HTMLElement;
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  assert.match(current.style.clipPath, /inset\(0 45% 0 0\)/, "arrow keys move the divider");
  assert.equal(
    localStorage.getItem("git-mapper:image-diff-mode"),
    JSON.stringify("swipe"),
    "the mode is persisted like the rest of the panel state",
  );
});

test("a failed load says so instead of showing an empty diff", async () => {
  vi.mocked(loadImageVersions).mockRejectedValue(new Error("backend missing"));
  const { container } = withImage(imageFile, "C:/repo", "abc123");
  await waitFor(() => {
    assert.ok(within(container).getByText("Could not read the image versions."));
  });
  assert.equal(container.querySelector("[data-diff-line]"), null, "no fake text rows appear");
});

test("without a repo path the image diff cannot even start", () => {
  const { container } = withImage(imageFile);
  assert.ok(within(container).getByText("Could not read the image versions."));
  assert.equal(vi.mocked(loadImageVersions).mock.calls.length, 0, "no backend call is made");
});

test("image files below the fold defer their blob read until scrolled near", async () => {
  // jsdom has no IntersectionObserver (so every other test loads instantly); this one stubs one
  // that reports the section as off-screen until it is told otherwise.
  class FakeIO {
    static instances: FakeIO[] = [];
    cb: (entries: { isIntersecting: boolean }[]) => void;
    constructor(cb: FakeIO["cb"]) {
      this.cb = cb;
      FakeIO.instances.push(this);
    }
    observe() {
      this.cb([{ isIntersecting: false }]);
    }
    disconnect() {}
    unobserve() {}
  }
  (window as unknown as Record<string, unknown>).IntersectionObserver = FakeIO;
  try {
    vi.mocked(loadImageVersions).mockResolvedValue({ previous: png(8), current: png(16) });
    const { container } = withImage(imageFile, "C:/repo", "abc123");

    assert.ok(container.querySelector("[data-image-deferred]"), "a placeholder holds the section");
    assert.equal(
      vi.mocked(loadImageVersions).mock.calls.length,
      0,
      "an off-screen image asks the backend for nothing",
    );

    FakeIO.instances[0].cb([{ isIntersecting: true }]);
    await waitFor(() => {
      assert.equal(container.querySelectorAll("[data-image-side]").length, 2);
    });
    assert.equal(vi.mocked(loadImageVersions).mock.calls.length, 1, "the read starts on arrival");
    assert.equal(container.querySelector("[data-image-deferred]"), null);
  } finally {
    delete (window as unknown as Record<string, unknown>).IntersectionObserver;
  }
});

test("a renamed file reads from what to what, with its similarity", () => {
  const renamedFile: ChangedFile = {
    path: "src/renamed.ts",
    oldPath: "src/old-name.ts",
    renameScore: 92,
    status: "renamed",
    additions: 1,
    deletions: 1,
    diff: [{ type: "add", text: "moved" }],
  };
  const { container } = render(
    <DiffViewer files={[renamedFile]} file={renamedFile} scope="file" onScopeChange={() => {}} scheme="app" />,
  );

  const header = container.querySelector("[data-diff] > div")?.textContent ?? "";
  assert.ok(header.includes("src/old-name.ts"), "the source path is on the header");
  assert.ok(header.includes("→"), "an arrow points from old to new");
  assert.ok(header.includes("src/renamed.ts"), "the live path is on the header");
  assert.ok(within(container).getByText("92%"), "a partial rename carries its similarity");
  assert.ok(within(container).getByText("Renamed"));

  // The all-files scope's sticky header carries the same story.
  const all = render(
    <DiffViewer files={[renamedFile]} file={renamedFile} scope="all" onScopeChange={() => {}} scheme="app" />,
  );
  const sectionHeader = all.container.querySelector("[data-diff-file] > div")?.textContent ?? "";
  assert.ok(sectionHeader.includes("src/old-name.ts") && sectionHeader.includes("→"));
});

test("a full rename shows no similarity chip", () => {
  const movedFile: ChangedFile = {
    path: "docs/moved.md",
    oldPath: "docs/old.md",
    renameScore: 100,
    status: "renamed",
    additions: 0,
    deletions: 0,
    diff: [],
  };
  const { container } = render(
    <DiffViewer files={[movedFile]} file={movedFile} scope="file" onScopeChange={() => {}} scheme="app" />,
  );
  assert.equal(within(container).queryByText("100%"), null, "R100 needs no percent chip");
  const header = container.querySelector("[data-diff] > div")?.textContent ?? "";
  assert.ok(
    header.includes("docs/old.md") && header.includes("→") && header.includes("docs/moved.md"),
  );
});

test("switching files never paints the previous file's tokens", async () => {
  // The css grammar never resolves here, so the window where the new file's tokens have not
  // arrived lasts forever — the exact conditions behind the "preview shows the previous file".
  highlightState.blockCss = true;
  const tsFile: ChangedFile = {
    path: "src/index.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    diff: [{ type: "add", text: "const answer = 42;" }],
  };
  const cssFile: ChangedFile = {
    path: "src/style.css",
    status: "added",
    additions: 1,
    deletions: 0,
    diff: [{ type: "add", text: "body { color: hotpink; }" }],
  };
  const props = {
    files: [tsFile, cssFile],
    scope: "file" as const,
    onScopeChange: () => {},
    scheme: "app" as const,
  };
  const view = render(<DiffViewer {...props} file={tsFile} />);
  await waitFor(() => {
    assert.ok(view.container.querySelector(".hljs-keyword"), "the ts file is tokenized");
  });

  view.rerender(<DiffViewer {...props} file={cssFile} />);
  assert.equal(
    view.container.querySelector(".hljs-keyword"),
    null,
    "the previous file's tokens never paint on the new file",
  );
  assert.ok(
    view.container.textContent?.includes("body { color: hotpink; }"),
    "the new file's rows show, plain until their grammar lands",
  );
  assert.ok(
    !view.container.textContent?.includes("const answer"),
    "the previous file's content is gone the moment the selection moves",
  );
});

test("switching between image files reads the newly selected file's versions", async () => {
  vi.mocked(loadImageVersions).mockImplementation(async (_repo, _hash, path) => ({
    previous: {
      url: `data:image/png;base64,${path === "a.png" ? "old-a" : "old-b"}`,
      bytes: 10,
      tooLarge: false,
    },
    current: {
      url: `data:image/png;base64,${path === "a.png" ? "new-a" : "new-b"}`,
      bytes: 20,
      tooLarge: false,
    },
  }));
  const aFile: ChangedFile = { path: "a.png", status: "modified", additions: 0, deletions: 0, diff: [] };
  const bFile: ChangedFile = { path: "b.png", status: "modified", additions: 0, deletions: 0, diff: [] };
  const props = {
    files: [aFile, bFile],
    scope: "file" as const,
    onScopeChange: () => {},
    scheme: "app" as const,
    repoPath: "C:/repo",
    commitHash: "abc123",
  };
  const view = render(<DiffViewer {...props} file={aFile} />);
  await waitFor(() => {
    assert.ok(
      (view.container.querySelector("[data-image-src='current']")?.getAttribute("src") ?? "").includes("new-a"),
    );
  });

  // The selection moved to b.png: the picture diff must follow, not keep a.png's blobs.
  view.rerender(<DiffViewer {...props} file={bFile} />);
  await waitFor(() => {
    const src = view.container.querySelector("[data-image-src='current']")?.getAttribute("src") ?? "";
    assert.ok(src.includes("new-b"), "the pane shows the newly selected file's version");
  });
  assert.equal(
    vi.mocked(loadImageVersions).mock.calls.at(-1)?.[2],
    "b.png",
    "the read names the newly selected path",
  );
});
