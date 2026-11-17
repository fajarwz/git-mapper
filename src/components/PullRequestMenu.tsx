import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PullRequest } from "../types";
import type { PullRequestsView } from "../hooks/usePullRequests";
import { openExternal } from "../lib/external";
import { formatAbsoluteDate } from "../lib/format";
import { GLASS_CONTROL, PANEL } from "../lib/ui";
import {
  PR_STATE,
  PROVIDER_NAME,
  describePullRequest,
  pullRequestLabel,
  requestNoun,
} from "../lib/pullRequestTone";
import { PullRequestIcon } from "./icons";

type Filter = "open" | "all";

const LIVE = new Set(["open", "draft"]);

/** The CLI each provider's list comes from, with where to get it and how to sign in. */
const CLI = {
  github: { name: "GitHub CLI", program: "gh", site: "cli.github.com" },
  gitlab: { name: "GitLab CLI", program: "glab", site: "gitlab.com/gitlab-org/cli" },
} as const;

function Row({ pull }: { pull: PullRequest }) {
  return (
    <button
      type="button"
      data-pr-row
      onClick={() => openExternal(pull.url)}
      title={`Open on ${PROVIDER_NAME[pull.provider]}`}
      className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-hover-glass focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <span
        aria-label={PR_STATE[pull.state].label}
        role="img"
        className="mt-1.25 size-2 shrink-0 rounded-full"
        style={{ backgroundColor: PR_STATE[pull.state].color }}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[12.5px] text-ink">
          <span className="font-mono text-ink-dim">{pullRequestLabel(pull)}</span> {pull.title}
        </span>
        <span className="truncate text-[11px] text-ink-dim">
          {pull.headBranch} → {pull.baseBranch}
          {pull.author && ` · ${pull.author}`} · {formatAbsoluteDate(pull.updatedAt)}
        </span>
        <span className="truncate text-[11px] text-ink-soft">{describePullRequest(pull)}</span>
      </span>
    </button>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="m-0 px-2.5 py-3 text-[12px] leading-relaxed text-ink-dim">{children}</p>;
}

/**
 * The title-bar door to the repo's pull (GitLab: merge) requests: a button with the open count
 * and a popover listing them. Read-only on purpose — a row opens the request on its site. A
 * repository with no GitHub or GitLab remote shows nothing at all.
 */
export function PullRequestMenu({ pulls }: { pulls: PullRequestsView }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("open");
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const rect = button.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    const close = () => setOpen(false);
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const live = useMemo(() => pulls.pulls.filter((pull) => LIVE.has(pull.state)), [pulls.pulls]);
  const shown = filter === "open" ? live : pulls.pulls;

  if (pulls.status === "unsupported-remote") return null;

  const nouns = requestNoun(pulls.provider, true);
  const lower = nouns.toLowerCase();
  const cli = pulls.provider === null ? null : CLI[pulls.provider];

  return (
    <>
      <button
        ref={button}
        type="button"
        data-pr-menu
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={nouns}
        title={
          live.length > 0
            ? `${live.length} open ${requestNoun(pulls.provider, live.length !== 1).toLowerCase()}`
            : nouns
        }
        className={`${GLASS_CONTROL} relative grid place-items-center text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 size-7 ${
          open ? "border-primary-ink/40 bg-glass-strong text-ink soft-shadow" : ""
        }`}
      >
        <PullRequestIcon size={13} className={pulls.loading ? "animate-pulse" : undefined} />
        {live.length > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-success font-mono text-[9px] font-bold leading-none text-white soft-shadow"
          >
            {live.length > 9 ? "9+" : live.length}
          </span>
        )}
      </button>

      {open && position && createPortal(
        // Portaled to <body>: the title bar's backdrop blur would otherwise become the
        // containing block of this fixed panel and drag it out of place.
        <div
          ref={panel}
          role="dialog"
          aria-label={nouns}
          data-pr-panel
          style={{ top: position.top, right: position.right }}
          className={`${PANEL} fixed z-50 flex max-h-[70vh] w-96 max-w-[calc(100vw-16px)] flex-col p-1.5`}
        >
          <div className="flex items-center justify-between gap-2 px-2.5 py-1">
            <div role="group" aria-label={`Filter ${lower}`} className="flex gap-1">
              {(["open", "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className="rounded-full px-2.5 py-0.5 text-[11.5px] text-ink-dim hover:text-ink aria-pressed:bg-glass-strong aria-pressed:text-ink aria-pressed:soft-shadow"
                >
                  {value === "open" ? `Open ${live.length}` : `All ${pulls.pulls.length}`}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={pulls.reload}
              disabled={pulls.loading}
              className="rounded-full px-2 py-0.5 text-[11.5px] text-ink-dim hover:text-ink disabled:opacity-50"
            >
              {pulls.loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {pulls.status === "cli-missing" && (
              <Notice>
                {cli ? (
                  <>
                    {nouns} come from the {cli.name}, which is not installed. Install <b>{cli.program}</b>{" "}
                    from {cli.site}, then refresh.
                  </>
                ) : (
                  <>
                    {nouns} come from the GitHub CLI (<b>gh</b>) or the GitLab CLI (<b>glab</b>), and
                    neither is installed. Install the one for your host, then refresh.
                  </>
                )}
              </Notice>
            )}
            {pulls.status === "cli-unauthenticated" && (
              <Notice>
                The {cli?.name ?? "provider CLI"} is not signed in for this repository&apos;s host. Run{" "}
                <code className="font-mono">{cli?.program ?? "gh"} auth login</code> in a terminal, then
                refresh.
              </Notice>
            )}
            {pulls.error !== null && (
              <Notice>
                Could not read {lower}: {pulls.error}
              </Notice>
            )}
            {pulls.status === "ok" && shown.length === 0 && (
              <Notice>{filter === "open" ? `No open ${lower}.` : `No ${lower}.`}</Notice>
            )}
            {pulls.status === null && pulls.error === null && <Notice>Loading {lower}…</Notice>}
            {pulls.status === "ok" && shown.map((pull) => <Row key={pull.number} pull={pull} />)}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
