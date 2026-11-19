import { StarIcon } from "../../shared/components/icons";
import { Toast } from "../../shared/components/Toast";

export function StarPrompt({
  onStar,
  onLater,
  last,
}: {
  onStar: () => void;
  onLater: () => void;
  last: boolean;
}) {
  return (
    <Toast
      title="Enjoying Git Mapper?"
      detail={`${last ? "Last time we'll ask. " : ""}If it is useful, a star on GitHub helps a lot.`}
      icon={<StarIcon size={14} />}
      onClose={onLater}
      closeOnEscape
    >
      {(close) => (
        <div className="mt-2 flex items-center gap-3">
          {/* Starring leaves for the browser, so it closes at once rather than fading. */}
          <button
            type="button"
            onClick={onStar}
            className="whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Star on GitHub
          </button>
          <button
            type="button"
            onClick={close}
            className="whitespace-nowrap rounded text-[12px] font-medium text-surface/75 hover:text-surface focus-visible:underline focus-visible:outline-none"
          >
            Later
          </button>
        </div>
      )}
    </Toast>
  );
}
