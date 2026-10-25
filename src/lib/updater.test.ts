// The updater store, with the Tauri plugins mocked: check → download → ready → relaunch.
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import {
  checkForUpdates,
  downloadUpdate,
  onUpdateStatus,
  restartToUpdate,
  updateStatusSnapshot,
} from "./updater";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

/** Pretend we are inside the Tauri window so the store stops refusing to work. */
function enterTauriRelease() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

beforeEach(() => {
  enterTauriRelease();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

const update = (version: string) => ({
  version,
  downloadAndInstall: vi.fn(async (onEvent?: (event: { event: string; data: { chunkLength?: number; contentLength?: number } }) => void) => {
    onEvent?.({ event: "Started", data: { contentLength: 100 } });
    onEvent?.({ event: "Progress", data: { chunkLength: 60 } });
    onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
    onEvent?.({ event: "Finished", data: {} });
  }),
});

test("manual mode stops at available and waits for the download", async () => {
  vi.mocked(check).mockResolvedValue(update("0.2.0") as never);

  await checkForUpdates("manual");

  assert.equal(updateStatusSnapshot().phase, "available");
  assert.equal(updateStatusSnapshot().version, "0.2.0");
  assert.equal(vi.mocked(relaunch).mock.calls.length, 0);
});

test("auto mode downloads in the background and lands on ready", async () => {
  const found = update("0.2.0");
  vi.mocked(check).mockResolvedValue(found as never);

  await checkForUpdates("auto");

  assert.ok(found.downloadAndInstall.mock.calls.length > 0, "the download ran without asking");
  assert.equal(updateStatusSnapshot().phase, "ready");
  assert.equal(updateStatusSnapshot().version, "0.2.0");
});

test("no update on the feed reads as current", async () => {
  vi.mocked(check).mockResolvedValue(null as never);

  await checkForUpdates("auto");

  assert.equal(updateStatusSnapshot().phase, "current");
});

test("a feed failure lands on error with the message, not a crash", async () => {
  vi.mocked(check).mockRejectedValue(new Error("offline"));

  await checkForUpdates("auto");

  assert.equal(updateStatusSnapshot().phase, "error");
  assert.equal(updateStatusSnapshot().message, "offline");
});

test("download progress streams into the status and restartToUpdate relaunches", async () => {
  const found = update("0.3.0");
  vi.mocked(check).mockResolvedValue(found as never);
  await checkForUpdates("manual");

  const seen: string[] = [];
  const off = onUpdateStatus((status) => seen.push(status.phase));
  await downloadUpdate();
  off();

  assert.ok(seen.includes("downloading") && seen.includes("ready"), "the phases stream in order");
  assert.equal(updateStatusSnapshot().phase, "ready");

  await restartToUpdate();
  assert.equal(vi.mocked(relaunch).mock.calls.length, 1);
});
