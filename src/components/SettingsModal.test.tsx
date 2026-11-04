// @vitest-environment jsdom
// The settings modal's about card: the donate entry is a quiet text link that opens Sponsors,
// and the GitHub button still opens the repository after both share one opener.
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { SettingsModal } from "./SettingsModal";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSettings() {
  return render(
    <SettingsModal
      theme="light"
      onThemeChange={() => {}}
      showAvatars
      onShowAvatarsChange={() => {}}
      syntaxScheme="app"
      onSyntaxSchemeChange={() => {}}
      appVersion="1.3.1"
      updateMode="auto"
      onUpdateModeChange={() => {}}
      updateStatus={{ phase: "idle" }}
      onCheckForUpdates={() => {}}
      onDownloadUpdate={() => {}}
      onRestartToUpdate={() => {}}
      onClose={() => {}}
    />,
  );
}

test("the donate link opens GitHub Sponsors", () => {
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  renderSettings();

  fireEvent.click(screen.getByRole("button", { name: /support this project/i }));

  assert.equal(opened.mock.calls[0][0], "https://github.com/sponsors/fajarwz");
});

test("the donate link reads as a quiet link, not a call to action", () => {
  renderSettings();

  const donate = screen.getByRole("button", { name: /support this project/i });

  assert.match(donate.className, /text-ink-dim/);
  assert.doesNotMatch(donate.className, /bg-primary|bg-danger/);
});

test("the GitHub button opens the repository", () => {
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  renderSettings();

  fireEvent.click(screen.getByRole("button", { name: "GitHub" }));

  assert.equal(opened.mock.calls[0][0], "https://github.com/fajarwz/git-mapper");
});
