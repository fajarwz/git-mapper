import { useEffect, type ReactNode } from "react";
import { useExit } from "../lib/useExit";
import { AlertIcon, CloseIcon } from "./icons";

/**
 * A bottom-right notice. Failures used to be invisible whenever a repository was already open —
 * the error line lived only on the empty state — so every open, checkout and restore failure
 * surfaces here. The default is an error that leaves on its own after a comfortable read; a
 * non-error notice (`icon` set) stays until dismissed and may carry `children` as its actions.
 */
export function Toast({
  title,
  detail,
  onClose,
  icon,
  closeOnEscape = false,
  children,
}: {
  title: string;
  detail?: string;
  /** Fires once the exit animation has played. */
  onClose: () => void;
  /** Replaces the alert glyph and turns the toast into a persistent, non-error notice. */
  icon?: ReactNode;
  closeOnEscape?: boolean;
  /** A function gets `close`, which plays the exit before `onClose` fires. */
  children?: ReactNode | ((close: () => void) => ReactNode);
}) {
  const persistent = icon !== undefined;
  const { leaving, close } = useExit(onClose);
  // `close` is stable, so parent re-renders never restart the countdown.
  useEffect(() => {
    if (persistent) return;
    const timer = window.setTimeout(close, 6000);
    return () => window.clearTimeout(timer);
  }, [persistent, close]);

  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOnEscape, close]);

  const badge = persistent ? "bg-primary" : "bg-danger";
  return (
    <div
      data-toast
      role={persistent ? "status" : "alert"}
      className={`fixed right-5 bottom-5 z-50 w-96 max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-2xl bg-ink text-surface ring-1 ring-surface/20 panel-shadow ${leaving ? "pop-out" : "pop-in-toast"}`}
    >
      <div className="flex items-start gap-3 p-4">
        <span className={`mt-px grid size-7 shrink-0 place-items-center rounded-full text-white ${badge}`}>
          {icon ?? <AlertIcon />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[14px] leading-snug font-bold wrap-break-word">{title}</span>
          {detail && (
            <p
              className={`m-0 wrap-break-word whitespace-pre-line text-surface/75 ${
                persistent ? "text-[12px] leading-relaxed" : "font-mono text-[11.5px] leading-relaxed"
              }`}
            >
              {detail}
            </p>
          )}
          {typeof children === "function" ? children(close) : children}
        </div>
        <button
          type="button"
          onClick={close}
          title="Dismiss"
          aria-label="Dismiss notice"
          className="grid size-6 shrink-0 place-items-center rounded-full text-surface/70 hover:bg-surface/15 hover:text-surface focus-visible:ring-2 focus-visible:ring-primary"
        >
          <CloseIcon />
        </button>
      </div>
      {!persistent && <div aria-hidden="true" className="h-1 w-full bg-danger toast-drain" />}
    </div>
  );
}
