import assert from "node:assert/strict";
import { test } from "vitest";

import { emailSha256Hex, gravatarPhotoUrl } from "./avatarPhoto";

// NIST's example vectors for SHA-256 — the fixture the hash must clear before anything else.
const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const SHA256_ABC_ABC = "bbb59da3af939f7af5f360f2ceb80a496e3bae1cd87dde426db0ae40677e1c2c";

test("the email hash is sha256 over the spec-normalised address", async () => {
  if (globalThis.crypto?.subtle === undefined) return; // The photo path needs WebCrypto.
  assert.equal(await emailSha256Hex("abc"), SHA256_ABC);
  assert.equal(await emailSha256Hex("  abc  "), SHA256_ABC, "trimmed");
  assert.equal(await emailSha256Hex("ABC"), SHA256_ABC, "lowercased");
  assert.equal(await emailSha256Hex("abcabc"), SHA256_ABC_ABC);
});

test("the photo URL carries the hash into gravatar's d=404 endpoint", async () => {
  if (globalThis.crypto?.subtle === undefined) return;
  const url = await gravatarPhotoUrl("abc");
  assert.equal(url, `https://www.gravatar.com/avatar/${SHA256_ABC}?s=64&d=404`);
});
