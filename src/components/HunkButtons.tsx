import { useState } from "react";
import type { HunkAction, WipSide } from "../data/gitLoader";
import { ConfirmDialog } from "./ConfirmDialog";

/** What the diff pane needs to act on hunks: set only while the uncommitted diff is showing. */
export interface HunkActions {
  side: WipSide;
  busy?: boolean;
  onAction: (path: string, hunkIndex: number, hunkHeader: string, action: HunkAction) => void;
}

const BUTTON_CLASS =
  "rounded-full border border-hairline bg-glass-soft px-2 py-0.5 font-sans text-[10.5px] font-semibold text-ink-dim backdrop-blur-md transition-colors hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50";

/**
 * VS Code's per-change buttons on a hunk header: Stage + Discard on the unstaged diff, Unstage
 * on the staged one. A discard throws edits away, so it asks first.
 */
export function HunkButtons({
  path,
  index,
  header,
  actions,
}: {
  path: string;
  index: number;
  header: string;
  actions: HunkActions;
}) {
  const [confirming, setConfirming] = useState(false);
  // "@@ Binary file, not shown @@" is a placeholder, not a hunk git could apply.
  if (!header.startsWith("@@ -")) return null;
  const run = (action: HunkAction) => actions.onAction(path, index, header, action);

  return (
    <span data-hunk-actions className="sticky right-3 ml-auto flex shrink-0 gap-1.5">
      {actions.side === "staged" ? (
        <button
          type="button"
          data-hunk-action="unstage"
          disabled={actions.busy}
          className={BUTTON_CLASS}
          onClick={() => run("unstage")}
        >
          Unstage hunk
        </button>
      ) : (
        <>
          <button
            type="button"
            data-hunk-action="stage"
            disabled={actions.busy}
            className={BUTTON_CLASS}
            onClick={() => run("stage")}
          >
            Stage hunk
          </button>
          <button
            type="button"
            data-hunk-action="discard"
            disabled={actions.busy}
            className={BUTTON_CLASS}
            onClick={() => setConfirming(true)}
          >
            Discard
          </button>
        </>
      )}
      {confirming && (
        <ConfirmDialog
          title="Discard this hunk?"
          body={`The edits in this hunk of ${path} are removed from the file on disk. This cannot be undone.`}
          confirmLabel="Discard hunk"
          danger
          onConfirm={() => {
            setConfirming(false);
            run("discard");
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </span>
  );
}
