// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, test } from "vitest";

import type { Repository, Submodule } from "../../types";
import { SubmoduleStrip } from "./SubmoduleStrip";

afterEach(cleanup);

const sub = (path: string, state: Submodule["state"]): Submodule => ({
  path,
  fullPath: `C:/app/${path}`,
  name: path,
  state,
  commit: "a".repeat(40),
});

const root = {
  id: "C:/app",
  name: "app",
  path: "C:/app",
  submodules: [sub("api", "ok"), sub("web", "moved"), sub("docs", "uninitialized")],
} as Repository;

function mount(activeId: string, onSelect: (id: string, submodule?: Submodule) => void = () => {}) {
  return render(
    <SubmoduleStrip root={root} repos={[root]} activeId={activeId} openingId={null} onSelect={onSelect} />,
  );
}

test("lists the repo first and marks the active item", () => {
  const { container } = mount("C:/app/api");
  const tabs = [...container.querySelectorAll("[role=tab]")];
  assert.deepEqual(
    tabs.map((tab) => tab.textContent),
    ["app", "api", "web", "docs"],
  );
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(tabs[0].getAttribute("aria-selected"), "false");
});

test("a moved submodule carries a marker, a clean one does not", () => {
  const { container } = mount("C:/app");
  assert.ok(container.querySelector("[data-submodule-tab=web] [role=img]"));
  assert.equal(container.querySelector("[data-submodule-tab=api] [role=img]"), null);
});

test("the repo pill carries a marker only while it has uncommitted changes", () => {
  const dirty = { ...root, changed: 2 } as Repository;
  const { container, rerender } = render(
    <SubmoduleStrip root={dirty} repos={[dirty]} activeId="C:/app" openingId={null} onSelect={() => {}} />,
  );
  const rootTab = () => container.querySelectorAll("[role=tab]")[0];
  assert.ok(rootTab().querySelector("[role=img]"));
  const clean = { ...root, changed: 0 } as Repository;
  rerender(
    <SubmoduleStrip root={clean} repos={[clean]} activeId="C:/app" openingId={null} onSelect={() => {}} />,
  );
  assert.equal(rootTab().querySelector("[role=img]"), null);
});

test("clicking reports the repo id, or the submodule with its record", () => {
  const picked: Array<[string, string | undefined]> = [];
  const { container } = mount("C:/app", (id, submodule) => picked.push([id, submodule?.path]));
  fireEvent.click(container.querySelector("[data-submodule-tab=api]") as HTMLElement);
  fireEvent.click(container.querySelectorAll("[role=tab]")[0] as HTMLElement);
  assert.deepEqual(picked, [
    ["C:/app/api", "api"],
    ["C:/app", undefined],
  ]);
});

test("an uninitialized submodule cannot be opened", () => {
  const picked: string[] = [];
  const { container } = mount("C:/app", (id) => picked.push(id));
  const docs = container.querySelector("[data-submodule-tab=docs]") as HTMLElement;
  assert.equal(docs.getAttribute("aria-disabled"), "true");
  fireEvent.click(docs);
  assert.deepEqual(picked, []);
});
