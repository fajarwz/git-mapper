import { useEffect, useRef } from "react";
import { CloseIcon, StarIcon } from "./icons";

/** A one-time, non-blocking ask to star the repo. Closing it (button or Esc) counts as "later". */
export function StarPrompt({
  onStar,
  onLater,
  onNever,
}: {
  onStar: () => void;
  onLater: () => void;
  onNever: () => void;
}) {
  const laterRef = useRef(onLater);
  laterRef.current = onLater;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") laterRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      data-star-prompt
      role="complementary"
      aria-label="Star Git Mapper on GitHub"
      className="fixed right-5 bottom-5 z-40 w-96 max-w-[calc(100vw-2.5rem)] rounded-2xl border border-hairline bg-glass-strong p-4 backdrop-blur-xl panel-shadow toast-in"
    >
      <div className="flex items-start gap-3">
        <span className="mt-px grid size-7 shrink-0 place-items-center rounded-full bg-primary text-white">
          <StarIcon size={14} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[14px] leading-snug font-bold text-ink">Enjoying Git Mapper?</span>
          <p className="m-0 text-[12px] leading-relaxed text-ink-soft">
            It is free and built by one person. If it is useful, a star on GitHub helps a lot.
          </p>
        </div>
        <button
          type="button"
          onClick={onLater}
          title="Maybe later"
          aria-label="Dismiss"
          className="grid size-6 shrink-0 place-items-center rounded-full text-ink-dim hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-3 pl-10">
        <button
          type="button"
          onClick={onStar}
          className="rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Star on GitHub
        </button>
        <button
          type="button"
          onClick={onLater}
          className="rounded text-[12px] font-medium text-ink-soft hover:text-ink focus-visible:underline focus-visible:outline-none"
        >
          Maybe later
        </button>
        <button
          type="button"
          onClick={onNever}
          className="ml-auto rounded text-[11px] text-ink-dim underline-offset-2 hover:text-ink hover:underline focus-visible:underline focus-visible:outline-none"
        >
          Don&apos;t ask again
        </button>
      </div>
    </div>
  );
}
