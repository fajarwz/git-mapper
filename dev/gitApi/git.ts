// @ts-expect-error type error without @types/node package
import { execFileSync } from "node:child_process";

/** One dev-server op: the same name and args the Tauri command takes, JSON out. */
export type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

export function run(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}
