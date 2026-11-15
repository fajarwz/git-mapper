import { useEffect, useRef } from "react";
import { StarIcon } from "./icons";
import { Toast } from "./Toast";

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
    <Toast
      title="Enjoying Git Mapper?"
      detail="If it is useful, a star on GitHub helps a lot."
      icon={<StarIcon size={14} />}
      onClose={onLater}
    >
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={onStar}
          className="whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Star on GitHub
        </button>
        <button
          type="button"
          onClick={onLater}
          className="whitespace-nowrap rounded text-[12px] font-medium text-surface/75 hover:text-surface focus-visible:underline focus-visible:outline-none"
        >
          Later
        </button>
        <button
          type="button"
          onClick={onNever}
          title="Don't ask again"
          className="ml-auto whitespace-nowrap rounded text-[12px] text-surface/55 underline-offset-2 hover:text-surface hover:underline focus-visible:underline focus-visible:outline-none"
        >
          Never
        </button>
      </div>
    </Toast>
  );
}
