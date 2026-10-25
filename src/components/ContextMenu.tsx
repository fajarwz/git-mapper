import { useEffect, useRef, useState } from "react";
import type { Commit, CommitRef } from "../types";
import { copyText } from "../lib/clipboard";

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
  onClose: () => void;
}

const ITEM =
  "flex w-full cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover-glass";

const COPY_LABELS: Record<CommitRef["type"], string> = {
  branch: "Copy branch name",
  remote: "Copy remote name",
  tag: "Copy tag name",
  stash: "Copy stash name",
};

/**
 * Right-click menu for a commit row or a ref pill. The checkout entry only appears for a
 * local branch that is not the checked-out one; the copy entries always match their target.
 * Copying keeps the menu up for a beat with a "Copied!" marker so the action reads, then closes.
 */
export function ContextMenu({ target, onCheckout, onClose }: ContextMenuProps) {
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
  // A local copy the callbacks can close over (TS will not narrow the prop inside them).
  const activeRef = target.ref;

  // Keep the menu on screen when opened near the right or bottom edge.
  const left = Math.max(4, Math.min(target.x, window.innerWidth - 240));
  const top = Math.max(4, Math.min(target.y, window.innerHeight - 180));

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
      className="fixed z-50 flex w-60 flex-col gap-0.5 rounded-xl border border-hairline bg-glass-strong p-1.5 panel-shadow backdrop-blur-xl"
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
      <button type="button" role="menuitem" className={ITEM}
        title="The short hash shown in the list"
        onClick={() => copy("hash", target.commit.hash)}
      >
        {copiedKey === "hash" ? "Copied!" : "Copy commit hash"}
      </button>
      {activeRef && (
        <button type="button" role="menuitem" className={ITEM}
          onClick={() => copy("ref", activeRef.name)}
        >
          {copiedKey === "ref" ? "Copied!" : COPY_LABELS[activeRef.type]}
        </button>
      )}
      <button type="button" role="menuitem" className={ITEM}
        onClick={() => copy("message", target.commit.subject)}
      >
        {copiedKey === "message" ? "Copied!" : "Copy commit message"}
      </button>
    </div>
  );
}
