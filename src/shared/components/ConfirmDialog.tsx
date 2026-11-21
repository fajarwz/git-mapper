import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExit } from "../lib/useExit";
import { PANEL } from "../lib/ui";
import { Button, ButtonVariant } from "./Button";

interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
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
  // Only dismissing fades out; confirming closes at once because the action runs right away.
  const { leaving, close } = useExit(onClose);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  // Portaled to <body>: `fixed` would otherwise be trapped by the nearest glass ancestor
  // (backdrop-filter makes it the containing block), and the discard confirm rendered inside
  // the staging rail scrolled its scrim down to the rail alone instead of the window.
  return createPortal(
    <div
      className={`fixed inset-0 z-40 grid place-items-center bg-scrim p-6 backdrop-blur-md ${leaving ? "fade-out" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className={`${PANEL} w-full max-w-md p-5 ${leaving ? "pop-out" : "pop-in"}`}
      >
        <h2 id="confirm-title" className="m-0 text-[16px] font-bold tracking-tight text-ink">
          {title}
        </h2>
        <div className="mb-0 mt-2 text-[12.5px] leading-relaxed text-ink-dim [&_p]:mb-0 [&_p:first-child]:mt-0 [&_p]:mt-1.5">
          {body}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button ref={closeRef} onClick={close}>
            Cancel
          </Button>
          <Button variant={danger ? ButtonVariant.Danger : ButtonVariant.Primary} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
