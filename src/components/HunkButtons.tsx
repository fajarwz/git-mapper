import { useState } from "react";
import type { HunkAction, WipSide } from "../data/gitLoader";
import { ConfirmDialog } from "./ConfirmDialog";

/** What the diff pane needs to act on hunks: set only while the uncommitted diff is showing. */
export interface HunkActions {
  side: WipSide;
  busy?: boolean;
  onAction: (path: string, hunkIndex: number, hunkHeader: string, action: HunkAction) => void;
  /** Same verbs on ticked lines of one hunk; absent = line picking is off. */
  onLines?: (
    path: string,
    hunkIndex: number,
    hunkHeader: string,
    action: HunkAction,
    lines: number[],
  ) => void;
}

/** "+2 −1": what a line pick will move, in the diff's own add/remove colours. */
function Tally({ add, remove }: { add: number; remove: number }) {
  return (
    <>
      {add > 0 && <span className="text-success-ink">+{add}</span>}
      {add > 0 && remove > 0 && " "}
      {remove > 0 && <span className="text-danger-ink">−{remove}</span>}
    </>
  );
}

const BUTTON_CLASS =
  "rounded-full border border-hairline bg-glass-soft px-2 py-0.5 font-sans text-[10.5px] font-semibold text-ink-dim backdrop-blur-md transition-colors hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50";

/**
 * VS Code's per-change buttons on a hunk header: Stage + Discard on the unstaged diff, Unstage
 * on the staged one. Once lines of the hunk are ticked the same buttons act on just those lines.
 * A discard throws edits away, so it asks first.
 */
export function HunkButtons({
  path,
  index,
  header,
  actions,
  picked = [],
  counts = { add: 0, remove: 0 },
  onClear = () => {},
}: {
  path: string;
  index: number;
  header: string;
  actions: HunkActions;
  /** Ticked changed lines of this hunk (ordinals among its +/- lines). */
  picked?: number[];
  /** The picked lines by kind: the label says "+1 −1", the same tally as the file header. */
  counts?: { add: number; remove: number };
  onClear?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // "@@ Binary file, not shown @@" is a placeholder, not a hunk git could apply.
  if (!header.startsWith("@@ -")) return null;
  const count = picked.length;
  const run = (action: HunkAction) => {
    if (count === 0) return actions.onAction(path, index, header, action);
    actions.onLines?.(path, index, header, action, picked);
    onClear();
  };
  const target = count === 0 ? "hunk" : <Tally {...counts} />;

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
          Unstage {target}
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
            Stage {target}
          </button>
          <button
            type="button"
            data-hunk-action="discard"
            disabled={actions.busy}
            className={BUTTON_CLASS}
            onClick={() => setConfirming(true)}
          >
            Discard{count > 0 && <> {target}</>}
          </button>
        </>
      )}
      {count > 0 && (
        <button
          type="button"
          data-hunk-action="clear"
          className={BUTTON_CLASS}
          onClick={onClear}
          aria-label="Clear picked lines"
        >
          Clear
        </button>
      )}
      {confirming && (
        <ConfirmDialog
          title={count > 0 ? "Discard the picked lines?" : "Discard this hunk?"}
          body={`The ${count > 0 ? "picked lines" : "edits in this hunk"} of ${path} are removed from the file on disk. This cannot be undone.`}
          confirmLabel={count > 0 ? "Discard lines" : "Discard hunk"}
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
