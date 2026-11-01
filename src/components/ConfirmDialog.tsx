import { useEffect, useRef, type ReactNode } from "react";
import { PANEL } from "../lib/ui";

interface ConfirmDialogProps {
  title: string;
  /** The story under the title: what happens, and the way back when there is one. */
  body: ReactNode;
  confirmLabel: string;
  /** Destructive confirmations (drop a stash) confirm in red; plain ones stay violet. */
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The dialog dangerous actions confirm through: checking out a commit detaches HEAD and the
 * stash actions can delete entries. The body spills the story (what the pill will read, what
 * is lost) because a first crash into that outcome is exactly the confusion this dialog
 * exists to prevent. Copy follows SettingsModal's modal pattern: backdrop panel, focus moved
 * in and returned, Escape and backdrop click cancel.
 */
export function ConfirmDialog({ title, body, confirmLabel, danger = false, onConfirm, onClose }: ConfirmDialogProps) {
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
        aria-labelledby="confirm-title"
        className={`${PANEL} w-full max-w-md p-5`}
      >
        <h2 id="confirm-title" className="m-0 text-[16px] font-bold tracking-tight text-ink">
          {title}
        </h2>
        <div className="mb-0 mt-2 text-[12.5px] leading-relaxed text-ink-dim [&_p]:mb-0 [&_p:first-child]:mt-0 [&_p]:mt-1.5">
          {body}
        </div>
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
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold soft-shadow transition-colors hover:brightness-110 ${
              danger
                ? // A filled #d5535e fails white-on-red AA (4.02:1); the app's danger pairing
                  // is the tinted fill with danger-ink text, which holds 4.5:1 in both themes.
                  "border border-danger/30 bg-danger/15 text-danger-ink hover:bg-danger/25"
                : "bg-primary text-white"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
