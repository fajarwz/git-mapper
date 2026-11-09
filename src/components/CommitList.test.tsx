// The commit table: optional columns switch from the header's right-click menu and persist.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, test } from "vitest";

import { CommitList } from "./CommitList";
import { STORAGE_KEYS } from "../lib/persisted";
import type { Commit, Repository } from "../types";

beforeEach(() => {
  localStorage.clear();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const commit: Commit = {
  hash: "abcdef1234567890",
  subject: "add things",
  author: "Ada",
  authorEmail: "ada@example.com",
  date: "2026-01-02T03:04:05Z",
  lane: 0,
  branchColor: 0,
  parents: [],
  refs: [],
};
const repo = { name: "demo", commits: [commit] } as Repository;

function renderList() {
  return render(
    <CommitList
      repo={repo}
      commits={repo.commits}
      query=""
      selectedHash=""
      flashHashes={new Set()}
      onSelect={() => {}}
      loadingMore={false}
      showAvatars={false}
      onNearBottom={() => {}}
      onCheckoutBranch={() => {}}
    />,
  );
}

test("unticking Author in the header menu removes its header cell and row cell, and persists", () => {
  const { container } = renderList();
  const header = container.querySelector("[data-commit-header]") as HTMLElement;
  assert.ok(within(header).getByText("Author"));
  assert.ok(within(container).getByText("Ada"));

  fireEvent.contextMenu(header);
  const menu = container.ownerDocument.querySelector("[data-columns-menu]") as HTMLElement;
  fireEvent.click(within(menu).getByLabelText("Author"));

  assert.equal(within(header).queryByText("Author"), null);
  assert.equal(within(container).queryByText("Ada"), null, "the row drops the cell too");
  assert.ok(within(header).getByText("Date"), "other columns stay");
  assert.deepEqual(JSON.parse(localStorage.getItem(STORAGE_KEYS.commitColumns) ?? "{}").author, false);
});

test("the commit column is listed but cannot be switched off", () => {
  const { container } = renderList();
  fireEvent.contextMenu(container.querySelector("[data-commit-header]") as HTMLElement);
  const menu = container.ownerDocument.querySelector("[data-columns-menu]") as HTMLElement;
  assert.equal((within(menu).getByLabelText("Commit") as HTMLInputElement).disabled, true);
});

test("a saved column choice is restored", () => {
  localStorage.setItem(STORAGE_KEYS.commitColumns, JSON.stringify({ author: true, date: false, hash: false }));
  const { container } = renderList();
  const header = container.querySelector("[data-commit-header]") as HTMLElement;
  assert.equal(within(header).queryByText("Date"), null);
  assert.equal(within(header).queryByText("Hash"), null);
  assert.ok(within(header).getByText("Author"));
});

test("a saved column order lays the header cells and the row cells out the same way", () => {
  localStorage.setItem(STORAGE_KEYS.commitColumnOrder, JSON.stringify(["hash", "date", "message", "author"]));
  const { container } = renderList();
  const header = container.querySelector("[data-commit-header]") as HTMLElement;
  const ids = [...header.querySelectorAll("[data-column-id]")].map((el) => el.getAttribute("data-column-id"));
  assert.deepEqual(ids, ["hash", "date", "message", "author"]);
  const row = container.querySelector("[data-commit-row]") as HTMLElement;
  const text = row.textContent ?? "";
  assert.ok(text.indexOf("abcdef12") < text.indexOf("add things"), "the hash cell leads the row");
  assert.ok(text.indexOf("add things") < text.indexOf("Ada"), "the author cell trails the message");
});

test("hiding a column keeps the others' saved order", () => {
  localStorage.setItem(STORAGE_KEYS.commitColumnOrder, JSON.stringify(["date", "message", "author", "hash"]));
  localStorage.setItem(STORAGE_KEYS.commitColumns, JSON.stringify({ author: false, date: true, hash: true }));
  const { container } = renderList();
  const ids = [...container.querySelectorAll("[data-commit-header] [data-column-id]")].map((el) =>
    el.getAttribute("data-column-id"),
  );
  assert.deepEqual(ids, ["date", "message", "hash"]);
});
