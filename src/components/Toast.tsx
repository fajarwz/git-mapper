import { useEffect, useRef } from "react";
import { AlertIcon, CloseIcon } from "./icons";

/**
 * A transient failure notice, bottom-right. Failures used to be invisible whenever a repository
 * was already open — the error line lived only on the empty state — so every open, checkout and
 * restore failure now surfaces here, and leaves on its own after a comfortable read.
 */
export function Toast({
  title,
  detail,
  onClose,
}: {
  title: string;
  detail?: string;
  onClose: () => void;
}) {
  // The timer reads the callback through a ref: parent re-renders must not restart the countdown.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const timer = window.setTimeout(() => closeRef.current(), 6000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      data-toast
      role="alert"
      className="fixed right-5 bottom-5 z-50 w-96 max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-2xl bg-ink text-surface ring-1 ring-surface/20 panel-shadow toast-in"
    >
      <div className="flex items-start gap-3 p-4">
        <span className="mt-px grid size-7 shrink-0 place-items-center rounded-full bg-danger text-white">
          <AlertIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[14px] leading-snug font-bold wrap-break-word">{title}</span>
          {detail && (
            <p className="m-0 wrap-break-word whitespace-pre-line font-mono text-[11.5px] leading-relaxed text-surface/75">
              {detail}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Dismiss"
          aria-label="Dismiss notice"
          className="grid size-6 shrink-0 place-items-center rounded-full text-surface/70 hover:bg-surface/15 hover:text-surface focus-visible:ring-2 focus-visible:ring-danger"
        >
          <CloseIcon />
        </button>
      </div>
      <div aria-hidden="true" className="h-1 w-full bg-danger toast-drain" />
    </div>
  );
}
