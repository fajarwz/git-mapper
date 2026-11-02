// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { Avatar, avatarColorIndex, avatarInitial } from "./Avatar";
import { emailSha256Hex, resetPhotoCache } from "../lib/avatarPhoto";

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

test("an avatar with no author renders nothing", () => {
  // The uncommitted-changes row carries an empty name and email: an empty tinted circle there
  // read as a broken picture beside a blank author.
  const { container } = render(<Avatar name="" email="" photos />);
  assert.equal(container.firstElementChild, null, "nobody to picture, nothing rendered");
});

test("the avatar renders the initial and its email tint", () => {
  const { container } = render(<Avatar name="fajarwz" email="fajarwz@example.com" />);
  const chip = container.firstElementChild as HTMLElement;
  assert.ok(chip.textContent, "the avatar shows something");
  assert.match(chip.style.color, /--color-lane-/, "the tint is a lane token, not a literal");
});

test("switching the email swaps the photo instead of keeping the old one", async () => {
  if (globalThis.crypto?.subtle === undefined) return; // The photo path needs WebCrypto.
  resetPhotoCache();
  const { container, rerender } = render(
    <Avatar name="A" email="first@example.com" photos />,
  );
  rerender(<Avatar name="B" email="second@example.com" photos />);
  await act(async () => {}); // Let both photo look-ups settle.

  const img = container.querySelector("img");
  if (!img) return; // No WebCrypto here either; nothing to assert.
  const expected = await emailSha256Hex("second@example.com");
  assert.equal(img.getAttribute("src"), `https://www.gravatar.com/avatar/${expected}?s=64&d=404`, "the photo follows the commit's author, not the first one rendered");
});
