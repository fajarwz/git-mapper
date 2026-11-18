// A drag that unmounts its handle (the panel collapsed under the pointer) must not leave the
// body stuck in resize mode.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { ResizeHandle } from "./ResizeHandle";

afterEach(() => {
  cleanup();
  document.body.classList.remove("is-resizing");
});

function handle() {
  return (
    <ResizeHandle label="Test" min={0} max={100} measure={() => 50} onResize={() => {}} />
  );
}

test("pointerup ends the resize cursor", () => {
  const { getByRole } = render(handle());
  const el = getByRole("separator");
  el.setPointerCapture = () => {};
  el.hasPointerCapture = () => false;
  fireEvent.pointerDown(el, { clientX: 10 });
  assert.ok(document.body.classList.contains("is-resizing"));
  fireEvent.pointerUp(el);
  assert.ok(!document.body.classList.contains("is-resizing"));
});

test("unmounting mid-drag clears the resize cursor", () => {
  const { getByRole, unmount } = render(handle());
  const el = getByRole("separator");
  el.setPointerCapture = () => {};
  fireEvent.pointerDown(el, { clientX: 10 });
  assert.ok(document.body.classList.contains("is-resizing"));
  unmount();
  assert.ok(!document.body.classList.contains("is-resizing"));
});
