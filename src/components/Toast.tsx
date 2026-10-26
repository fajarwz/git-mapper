import { useEffect, useRef } from "react";
import { CloseIcon } from "./icons";

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
      role="status"
      className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-1 rounded-xl border border-hairline bg-glass-strong p-3 panel-shadow backdrop-blur-xl"
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[12.5px] font-bold wrap-break-word text-danger-ink">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Dismiss"
          aria-label="Dismiss notice"
          className="grid shrink-0 cursor-default place-items-center rounded-full text-ink-dim hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 size-5"
        >
          <CloseIcon />
        </button>
      </div>
      {detail && (
        <p className="m-0 wrap-break-word whitespace-pre-line font-mono text-[11px] leading-relaxed text-ink-dim">
          {detail}
        </p>
      )}
    </div>
  );
}
