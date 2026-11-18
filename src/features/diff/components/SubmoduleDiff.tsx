import type { ChangedFile, Submodule } from "../../../types";
import type { SubmodulePointer } from "../../submodules/submodule";
import { SubmoduleIcon } from "../../../shared/components/icons";

const SHORT = 8;

function Commit({ hash }: { hash: string }) {
  return (
    <code className="rounded bg-ink/6 px-1.5 py-0.5 font-mono text-[11.5px] text-ink" title={hash}>
      {hash.slice(0, SHORT)}
    </code>
  );
}

/**
 * A changed gitlink: git's patch is two `Subproject commit` lines, which read as noise. This
 * says what happened to the submodule and, when it is cloned here, offers to open it.
 */
export function SubmoduleDiff({
  file,
  pointer,
  submodule,
  onOpen,
}: {
  file: ChangedFile;
  pointer: SubmodulePointer;
  submodule?: Submodule;
  onOpen?: (fullPath: string) => void;
}) {
  const headline = !pointer.from
    ? "Submodule added"
    : !pointer.to
      ? "Submodule removed"
      : "Submodule pointer moved";
  const openable = submodule !== undefined && submodule.state !== "uninitialized" && pointer.to !== null;

  return (
    <div data-submodule-diff={file.path} className="flex flex-col gap-2.5 px-3.5 py-3 font-sans">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
        <SubmoduleIcon size={14} className="text-ink-dim" />
        {headline}
        {pointer.dirty && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10.5px] font-semibold text-warning-ink">
            has local changes
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
        {pointer.from && <Commit hash={pointer.from} />}
        {pointer.from && pointer.to && <span className="text-ink-dim">→</span>}
        {pointer.to && <Commit hash={pointer.to} />}
      </div>
      {onOpen && submodule && (
        <button
          type="button"
          disabled={!openable}
          title={openable ? undefined : "Not cloned here — nothing to open"}
          onClick={() => onOpen(submodule.fullPath)}
          className="w-fit rounded-full border border-hairline bg-glass-strong px-3 py-1 text-[11.5px] font-semibold text-ink transition-colors hover:bg-hover-glass focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50"
        >
          Open {submodule.name}
        </button>
      )}
    </div>
  );
}
