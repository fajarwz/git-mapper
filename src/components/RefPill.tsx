import type { CommitRef } from "../types";
import { laneColor } from "../lib/graphGeometry";
import { BranchIcon, RemoteIcon, TagIcon } from "./icons";

interface RefPillProps {
  ref: CommitRef;
  /** The pill carries its commit's lane colour, matching the graph node. */
  lane: number;
  /** Only local branches are checkout-able; double-clicking the pill switches to it. */
  onCheckout?: (branch: string) => void;
}

const ICONS = {
  branch: BranchIcon,
  remote: RemoteIcon,
  tag: TagIcon,
};

/** Branch / remote / tag label shown inline after a commit subject. */
export function RefPill({ ref, lane, onCheckout }: RefPillProps) {
  const Icon = ICONS[ref.type];
  const checkoutable = ref.type === "branch" && !ref.isCurrent && onCheckout !== undefined;

  return (
    <span
      onDoubleClick={checkoutable ? () => onCheckout?.(ref.name) : undefined}
      className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[10.5px] leading-none ${
        ref.isCurrent ? "font-bold text-surface" : "border-[1.5px] bg-transparent"
      } ${checkoutable ? "cursor-pointer" : ""}`}
      style={
        ref.isCurrent
          ? { backgroundColor: laneColor(lane) }
          : {
              borderColor: laneColor(lane),
              // Text slightly darker than the bordering dot colour for small-text contrast.
              color: `color-mix(in oklab, ${laneColor(lane)}, var(--color-ink) 55%)`,
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
            // on outline pills it takes the lane colour.
            borderLeft: `1px solid ${ref.isCurrent ? "var(--color-surface)" : laneColor(lane)}`,
          }}
        >
          {ref.withRemote}
        </span>
      )}
    </span>
  );
}
