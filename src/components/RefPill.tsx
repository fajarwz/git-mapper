import type { CommitRef, PullRequest } from "../types";
import { openExternal } from "../lib/external";
import { branchColor } from "../lib/graphGeometry";
import { PR_STATE, describePullRequest } from "../lib/pullRequestTone";
import { BranchIcon, RemoteIcon, StashIcon, TagIcon } from "./icons";

interface RefPillProps {
  ref: CommitRef;
  /** The branch's pull request, when it has one: a #number chip that opens it in the browser. */
  pullRequest?: PullRequest;
  /** The commit's branch colour index, so the pill matches its node. */
  color: number;
  /** Only local branches are checkout-able; double-clicking the pill switches to it. */
  onCheckout?: (branch: string) => void;
  /** Right-clicking the pill opens the context menu for this exact ref. */
  onContextMenu?: (ref: CommitRef, x: number, y: number) => void;
}

const ICONS: Record<CommitRef["type"], typeof BranchIcon> = {
  branch: BranchIcon,
  remote: RemoteIcon,
  tag: TagIcon,
  stash: StashIcon,
  head: BranchIcon,
};

/** Branch / remote / tag / stash / detached-HEAD label shown inline after a commit subject. */
export function RefPill({ ref, pullRequest, color, onCheckout, onContextMenu }: RefPillProps) {
  const Icon = ICONS[ref.type];
  const checkoutable = ref.type === "branch" && !ref.isCurrent && onCheckout !== undefined;
  const colorValue = branchColor(color);
  // A detached HEAD copies as plain "HEAD"; the longer story is display-only.
  const label = ref.type === "head" ? "HEAD (detached)" : ref.name;

  return (
    <span
      onDoubleClick={checkoutable ? () => onCheckout?.(ref.name) : undefined}
      onContextMenu={
        onContextMenu
          ? (event) => {
              // The pill menu targets THIS ref, not the row's default one.
              event.preventDefault();
              event.stopPropagation();
              onContextMenu(ref, event.clientX, event.clientY);
            }
          : undefined
      }
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
        ref.type === "head"
          ? "HEAD is detached here"
            : ref.isCurrent
          ? `${ref.type}: ${ref.name} (checked out)`
          : checkoutable
            ? `Double-click to checkout ${ref.name}`
            : `${ref.type}: ${ref.name}`
      }
    >
      <Icon size={10} />
      {label}
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
      {pullRequest && (
        // A span, not a button: the pill sits inside the row's own button. Clicks stop here so
        // opening the PR neither selects the row nor (double-click) checks the branch out.
        <span
          role="link"
          data-pr-badge
          aria-label={`Pull request #${pullRequest.number}: ${pullRequest.title}`}
          title={`#${pullRequest.number} ${pullRequest.title}\n${describePullRequest(pullRequest)}\nClick to open on GitHub`}
          onClick={(event) => {
            event.stopPropagation();
            openExternal(pullRequest.url);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className="ml-0.5 inline-flex cursor-pointer items-center gap-1 pl-1 font-medium hover:underline"
          style={{
            borderLeft: `1px solid ${ref.isCurrent ? "var(--color-surface)" : colorValue}`,
          }}
        >
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full ring-1 ring-surface"
            style={{ backgroundColor: PR_STATE[pullRequest.state].color }}
          />
          #{pullRequest.number}
        </span>
      )}
    </span>
  );
}
