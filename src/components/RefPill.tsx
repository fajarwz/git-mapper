import type { CommitRef } from "../types";
import { BranchIcon, RemoteIcon, TagIcon } from "./icons";

interface RefPillProps {
  ref: CommitRef;
}

const ICONS = {
  branch: BranchIcon,
  remote: RemoteIcon,
  tag: TagIcon,
};

const TONES: Record<CommitRef["type"], string> = {
  branch: "bg-primary/12 text-primary-ink",
  remote: "bg-secondary/12 text-secondary",
  tag: "bg-warning/18 text-warning-ink",
};

const CURRENT = "bg-primary text-white";

/** Branch / remote / tag label shown inline after a commit subject. */
export function RefPill({ ref }: RefPillProps) {
  const Icon = ICONS[ref.type];

  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[10.5px] font-semibold leading-none ${
        ref.isCurrent ? CURRENT : TONES[ref.type]
      }`}
      title={`${ref.type}: ${ref.name}`}
    >
      <Icon size={10} />
      {ref.name}
    </span>
  );
}
