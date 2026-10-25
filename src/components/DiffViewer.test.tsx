// The diff panel: bare tokens, signs in their own cell, status labels.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, render, within, waitFor } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { DiffViewer } from "./DiffViewer";
import type { ChangedFile } from "../types";

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
  const { container } = render(<DiffViewer file={null} scheme="app" />);
  assert.ok(within(container).getByText("Select a changed file to see its diff."));
});

test("DiffViewer renders bare text with the sign in its own cell", () => {
  const { container } = render(<DiffViewer file={sampleFile} scheme="app" />);
  assert.ok(within(container).getByText("src/app.tsx"));
  assert.ok(within(container).getByText("Modified"));
  assert.ok(within(container).getByText("+2"));
  assert.ok(within(container).getByText("−1"));
  const rows = [...container.querySelectorAll("[data-diff-line]")];
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

test("DiffViewer tokenizes the content once the grammar loads", async () => {
  const tsFile: ChangedFile = {
    path: "src/index.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    diff: [{ type: "add", text: "const answer = 42;" }],
  };
  const { container } = render(<DiffViewer file={tsFile} scheme="neon" />);
  await waitFor(() => {
    assert.ok(container.querySelector(".hljs-keyword"), "const is tokenized");
  });
  assert.ok(container.querySelector("[data-syntax='neon']"), "the palette scope is on the panel");
  const row = container.querySelector("[data-diff-line='add']")?.textContent ?? "";
  assert.ok(row.includes("const answer = 42;"),
    "token spans live inside the content cell; the row text is unchanged");
});
