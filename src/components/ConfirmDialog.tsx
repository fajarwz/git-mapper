import { useEffect, useRef } from "react";
import { PANEL } from "../lib/ui";

interface ConfirmDialogProps {
  /** The short hash the dialog asks about, shown in the title and body. */
  hash: string;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The one dangerous action this viewer offers: checking out a commit detaches HEAD, and commits
 * made there are lost unless a branch is created. The body spills the story (what the pill will
 * read, how to get back) because a first crash into detached HEAD is exactly the confusion this
 * dialog exists to prevent. Copy follows SettingsModal's modal pattern: backdrop panel, focus
 * moved in and returned, Escape and backdrop click cancel.
 */
export function ConfirmDialog({ hash, onConfirm, onClose }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Focus moves to Cancel (the safe answer) and hands back to the trigger on close.
  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-scrim p-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detach-title"
        className={`${PANEL} w-full max-w-md p-5`}
      >
        <h2 id="detach-title" className="m-0 text-[16px] font-bold tracking-tight text-ink">
          Check out commit {hash}?
        </h2>
        <p className="mt-2 mb-0 text-[12.5px] leading-relaxed text-ink-dim">
          HEAD will detach — the checked-out pill reads <span className="font-semibold text-ink">HEAD (detached)</span>.
          New commits you make there are lost unless you create a branch first.
        </p>
        <p className="mt-1.5 mb-0 text-[12.5px] leading-relaxed text-ink-dim">
          Double-click any branch pill to get back to it.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-lg border border-hairline bg-glass-strong px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-hover-glass"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-white soft-shadow transition-colors hover:brightness-110"
          >
            Check out &amp; detach
          </button>
        </div>
      </div>
    </div>
  );
}
