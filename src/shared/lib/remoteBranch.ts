import type { CommitRef } from "../../types";

export function localNameOfRemote(remoteRef: string): string {
  return remoteRef.slice(remoteRef.indexOf("/") + 1);
}

export function isCheckoutableRemote(ref: CommitRef): boolean {
  return ref.type === "remote" && ref.name.includes("/") && localNameOfRemote(ref.name) !== "HEAD";
}
