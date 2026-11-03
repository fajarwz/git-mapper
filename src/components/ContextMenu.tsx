import { useEffect, useRef, useState } from "react";
import type { Commit, CommitRef } from "../types";
import { UNCOMMITTED_HASH } from "../data/gitLoader";
import { copyText } from "../lib/clipboard";

/** What a stash row offers: the safe apply, or the two that need a confirm first. */
export type StashAction = "apply" | "pop" | "drop";

/** What the menu was opened on: a position, the row's commit, and the ref it targets. */
export interface ContextMenuTarget {
  x: number;
  y: number;
  commit: Commit;
  /** The pill that was right-clicked, or the row's most relevant ref. */
  ref?: CommitRef;
}

interface ContextMenuProps {
  target: ContextMenuTarget;
  onCheckout: (branch: string) => void;
  onCheckoutCommit: (hash: string) => void;
  onStashAction: (index: number, action: StashAction) => void;
  /** Undoing the tip commit: the menu entry exists only when the target IS the tip, the
   * branch is ahead of its remote, and the tip is a plain (non-merge) commit. */
  undoable?: boolean;
  onUndoCommit?: () => void;
  /** Full sha of HEAD at the last read: the row that is HEAD gets no checkout entry. */
  head: string;
  onClose: () => void;
}

const ITEM =
  "flex w-full cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover-glass";

const COPY_LABELS: Record<CommitRef["type"], string> = {
  branch: "Copy branch name",
  remote: "Copy remote name",
  tag: "Copy tag name",
  stash: "Copy stash name",
  head: "Copy ref name",
};

/**
 * Right-click menu for a commit row or a ref pill. The checkout entry only appears for a
 * local branch that is not the checked-out one; the copy entries always match their target.
 * Copying keeps the menu up for a beat with a "Copied!" marker so the action reads, then closes.
 */
export function ContextMenu({
  target,
  onCheckout,
  onCheckoutCommit,
  onStashAction,
  undoable = false,
  onUndoCommit,
  head,
  onClose,
}: ContextMenuProps) {
  // The entry that just copied shows "Copied!" for a beat; the others keep their labels.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Anything that is not this menu dismisses it: a click, a scroll anywhere, Escape, a resize.
  // Registered as soon as the menu mounts — safe because the right-click that opened it fired
  // its own pointerdown BEFORE this effect ran, and a left-click on an entry is stopped at the
  // menu (onPointerDown below) so the action still fires before the dismiss listener sees it.
  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (copiedKey === null) return;
    const timer = window.setTimeout(onClose, 700);
    return () => window.clearTimeout(timer);
  }, [copiedKey, onClose]);

  const branch = target.ref?.type === "branch" ? target.ref : null;
  const checkoutable = branch !== null && !branch.isCurrent;
  // The commit checkout detaches HEAD: real history rows only — the HEAD row itself offers
  // nothing (it is already out), the uncommitted row ("wip") is not a commit, and stash rows
  // check out nothing. The app confirms first.
  const commitCheckoutable =
    target.commit.stashIndex === undefined &&
    target.commit.hash !== UNCOMMITTED_HASH &&
    !head.startsWith(target.commit.hash);
  // A local copy the callbacks can close over (TS will not narrow the prop inside them).
  const activeRef = target.ref;

  // Keep the menu on screen when opened near the right or bottom edge.
  const left = Math.max(4, Math.min(target.x, window.innerWidth - 240));
  const stashIndex = target.commit.stashIndex;
  // The menu is ~32px an entry; the estimate grows with it so it never opens off-screen.
  const entries =
    (checkoutable ? 1 : 0) +
    (commitCheckoutable ? 1 : 0) +
    (undoable ? 1 : 0) +
    (stashIndex !== undefined ? 3 : 0) +
    1 + 1 + (activeRef ? 1 : 0); // two copy entries always: hash + (ref or none)
  const top = Math.max(4, Math.min(target.y, window.innerHeight - entries * 32 - 20));

  function copy(key: string, text: string) {
    setCopiedKey(key);
    void copyText(text);
  }

  return (
    <div
      ref={menuRef}
      data-context-menu
      role="menu"
      aria-label={`Actions for ${target.commit.hash}`}
      onPointerDown={(event) => event.stopPropagation()}
      className="fixed z-50 flex w-60 flex-col gap-0.5 rounded-xl border border-hairline bg-glass p-1.5 panel-shadow backdrop-blur-sm"
      style={{ left, top }}
    >
      {checkoutable && branch && (
        <button type="button" role="menuitem" className={ITEM}
          onClick={() => {
            onClose();
            onCheckout(branch.name);
          }}
        >
          Check out {branch.name}
        </button>
      )}
      {commitCheckoutable && (
        <button type="button" role="menuitem" className={ITEM}
          title="Detaches HEAD onto this commit — a warning shows first"
          onClick={() => {
            onClose();
            onCheckoutCommit(target.commit.hash);
          }}
        >
          {/* The menu is a fixed 240px: the label reads the short hash, like the list. */}
          Check out commit {target.commit.hash.slice(0, 8)}
        </button>
      )}
      {undoable && onUndoCommit && (
        <button type="button" role="menuitem" className={ITEM}
          title="Puts the tip commit's files back as staged, uncommitted work — a confirm shows first"
          onClick={() => {
            onClose();
            onUndoCommit();
          }}
        >
          Undo commit {target.commit.hash.slice(0, 8)}
        </button>
      )}
      {stashIndex !== undefined && (
        <>
          <button type="button" role="menuitem" className={ITEM}
            title="Bring the stash back into the working tree; the entry stays"
            onClick={() => {
              onClose();
              onStashAction(stashIndex, "apply");
            }}
          >
            Apply stash
          </button>
          <button type="button" role="menuitem" className={ITEM}
            title="Apply the stash and remove the entry — a warning shows first"
            onClick={() => {
              onClose();
              onStashAction(stashIndex, "pop");
            }}
          >
            Pop stash…
          </button>
          <button type="button" role="menuitem" className={ITEM}
            title="Remove the entry without applying it — a warning shows first"
            onClick={() => {
              onClose();
              onStashAction(stashIndex, "drop");
            }}
          >
            Drop stash…
          </button>
        </>
      )}
      {target.commit.hash !== UNCOMMITTED_HASH && (
        <button type="button" role="menuitem" className={ITEM}
          title="The short hash shown in the list"
          onClick={() => copy("hash", target.commit.hash)}
        >
          {copiedKey === "hash" ? "Copied!" : "Copy commit hash"}
        </button>
      )}
      {activeRef && (
        <button type="button" role="menuitem" className={ITEM}
          onClick={() => copy("ref", activeRef.name)}
        >
          {copiedKey === "ref" ? "Copied!" : COPY_LABELS[activeRef.type]}
        </button>
      )}
    </div>
  );
}
