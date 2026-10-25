import type { CommitRef } from "../types";
import { branchColor } from "../lib/graphGeometry";
import { BranchIcon, RemoteIcon, StashIcon, TagIcon } from "./icons";

interface RefPillProps {
  ref: CommitRef;
  /** The commit's branch colour index, so the pill matches its node. */
  color: number;
  /** Only local branches are checkout-able; double-clicking the pill switches to it. */
  onCheckout?: (branch: string) => void;
}

const ICONS = {
  branch: BranchIcon,
  remote: RemoteIcon,
  tag: TagIcon,
  stash: StashIcon,
};

/** Branch / remote / tag / stash label shown inline after a commit subject. */
export function RefPill({ ref, color, onCheckout }: RefPillProps) {
  const Icon = ICONS[ref.type];
  const checkoutable = ref.type === "branch" && !ref.isCurrent && onCheckout !== undefined;
  const colorValue = branchColor(color);

  return (
    <span
      onDoubleClick={checkoutable ? () => onCheckout?.(ref.name) : undefined}
      className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[10.5px] leading-none ${
        ref.isCurrent ? "font-bold text-surface" : "border-[1.5px] bg-transparent"
      } ${checkoutable ? "cursor-pointer" : ""}`}
      style={
        ref.isCurrent
          ? { backgroundColor: colorValue }
          : {
              borderColor: colorValue,
              // Text slightly darker than the bordering dot colour for small-text contrast.
              color: `color-mix(in oklab, ${colorValue}, var(--color-ink) 55%)`,
            }
      }
      title={
        ref.isCurrent
          ? `${ref.type}: ${ref.name} (checked out)`
          : checkoutable
            ? `Double-click to checkout ${ref.name}`
            : `${ref.type}: ${ref.name}`
      }
    >
      <Icon size={10} />
      {ref.name}
      {ref.withRemote && (
        <span
          className="ml-0.5 pl-1 font-medium opacity-90"
          style={{
            // On the filled (checked-out) pill the divider takes the text colour;
            // on outline pills it takes the branch colour.
            borderLeft: `1px solid ${ref.isCurrent ? "var(--color-surface)" : colorValue}`,
          }}
        >
          {ref.withRemote}
        </span>
      )}
    </span>
  );
}
