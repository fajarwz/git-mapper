// @vitest-environment jsdom
import assert from "node:assert/strict";
import { cleanup, render } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { Avatar, avatarColorIndex, avatarInitial } from "./Avatar";

afterEach(cleanup);

test("avatar initial is the name's first letter, uppercased", () => {
  assert.equal(avatarInitial("fajarwz"), "F");
  assert.equal(avatarInitial("  Jane Doe"), "J");
  // A nameless author still gets a slot, not an empty bullet.
  assert.ok(/[^A-Z]/.test(avatarInitial("")), "a bare name falls back to a placeholder");
});

test("the colour slot is a stable function of the email", () => {
  assert.equal(avatarColorIndex("fajarwz@example.com"), avatarColorIndex("fajarwz@example.com"), "same email, same tint across sessions");
  assert.equal(avatarColorIndex("fajarwz@example.com"), avatarColorIndex("FAJARWZ@EXAMPLE.COM".toLowerCase()), "hash is case-stable");
  assert.ok(avatarColorIndex("fajarwz@example.com") >= 0 && avatarColorIndex("fajarwz@example.com") < 8, "the slot lands in the palette");
  assert.notEqual(avatarColorIndex("fajarwz@example.com"), avatarColorIndex("someone-else@example.com"), "different authors mostly differ");
});

test("the avatar renders the initial and its email tint", () => {
  const { container } = render(<Avatar name="fajarwz" email="fajarwz@example.com" />);
  const chip = container.firstElementChild as HTMLElement;
  assert.ok(chip.textContent, "the avatar shows something");
  assert.match(chip.style.color, /--color-lane-/, "the tint is a lane token, not a literal");
});
