import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  addRemote,
  checkoutCommit,
  checkoutRemoteBranch,
  createBranch,
  createTag,
  deleteBranch,
  deleteRemoteTag,
  deleteTag,
  listRemotes,
  localBranchExists,
  pushBranchTo,
  pushTag,
  removeRemote,
  renameRemote,
  setUpstream,
  tagExists,
} from "./gitLoader";
import { RemoteCheckoutMode } from "../types";

globalThis.window = { __TAURI_INTERNALS__: true };

const GIT_DIR = new URL("../../src-tauri/src/git/", import.meta.url);
const LIB_RS = new URL("../../src-tauri/src/lib.rs", import.meta.url);

const camel = (snake: string) => snake.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** Every `#[tauri::command]` fn in the git module: command name -> the camelCase keys Tauri expects. */
function rustCommands(): Map<string, string[]> {
  const commands = new Map<string, string[]>();
  for (const file of readdirSync(GIT_DIR).filter((name) => name.endsWith(".rs") && !name.endsWith("_tests.rs"))) {
    const source = readFileSync(new URL(file, GIT_DIR), "utf8");
    for (const match of source.matchAll(/#\[tauri::command\]\s*pub async fn (\w+)\(([^)]*)\)/g)) {
      const params = match[2]
        .split(",")
        .map((param) => param.split(":")[0].trim())
        .filter(Boolean);
      commands.set(match[1], params.map(camel));
    }
  }
  return commands;
}

const DIR = "/r";
const CASES: [string, () => Promise<unknown>][] = [
  ["tag_exists", () => tagExists(DIR, "v1")],
  ["create_tag", () => createTag(DIR, "v1", "abcd1234", "msg")],
  ["delete_tag", () => deleteTag(DIR, "v1")],
  ["push_tag", () => pushTag(DIR, "v1", "origin")],
  ["delete_remote_tag", () => deleteRemoteTag(DIR, "v1", "origin")],
  ["list_remotes", () => listRemotes(DIR)],
  ["add_remote", () => addRemote(DIR, "fork", "https://x/f.git")],
  ["rename_remote", () => renameRemote(DIR, "fork", "mirror")],
  ["remove_remote", () => removeRemote(DIR, "fork")],
  ["set_upstream", () => setUpstream(DIR, "topic", "origin", "topic")],
  ["push_branch_to", () => pushBranchTo(DIR, "topic", "origin", "topic")],
  ["create_branch", () => createBranch(DIR, "topic", "abcd1234", true)],
  ["delete_branch", () => deleteBranch(DIR, "topic", false, false)],
  ["local_branch_exists", () => localBranchExists(DIR, "topic")],
  ["checkout_remote_branch", () => checkoutRemoteBranch(DIR, "origin/topic", "topic", RemoteCheckoutMode.Create)],
  ["checkout_commit", () => checkoutCommit(DIR, "abcd1234")],
];

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.mocked(invoke).mockRestore();
});

test("every wrapper sends exactly the arguments its Rust command declares", async () => {
  const commands = rustCommands();
  assert.ok(commands.size > 20, "the Rust source was read");

  for (const [command, run] of CASES) {
    const expected = commands.get(command);
    assert.ok(expected, `${command} is a #[tauri::command] in src-tauri/src/git`);
    vi.mocked(invoke).mockClear();
    await run().catch(() => undefined);

    const [calledCommand, args] = vi.mocked(invoke).mock.calls[0] as [string, Record<string, unknown>];
    assert.equal(calledCommand, command);
    assert.deepEqual(Object.keys(args).sort(), [...expected].sort(), `${command} arguments match the Rust parameters`);
  }
});

test("every command the wrappers call is registered in the Tauri handler", () => {
  const registered = readFileSync(LIB_RS, "utf8");
  for (const [command] of CASES) {
    assert.match(registered, new RegExp(`git::${command}\\b`), `${command} is in generate_handler!`);
  }
});
