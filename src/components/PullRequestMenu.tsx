import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PullRequest } from "../types";
import type { PullRequestsView } from "../hooks/usePullRequests";
import { openExternal } from "../lib/external";
import { formatAbsoluteDate } from "../lib/format";
import { GLASS_CONTROL, PANEL } from "../lib/ui";
import { PR_PAGE_SIZE } from "../lib/pullRequests";
import {
  CHECK_TONE,
  PR_STATE,
  PROVIDER_NAME,
  REVIEW_TONE,
  compactCount,
  pullRequestLabel,
  requestNoun,
} from "../lib/pullRequestTone";
import { AlertIcon, CheckIcon, CloseIcon, ExternalIcon, PullRequestIcon, RefreshIcon } from "./icons";
import { PullRequestStateIcon } from "./PullRequestStateIcon";

type Filter = "open" | "all";

/** The CLI each provider's list comes from, with where to get it and how to sign in. */
const CLI = {
  github: { name: "GitHub CLI", program: "gh", site: "cli.github.com" },
  gitlab: { name: "GitLab CLI", program: "glab", site: "gitlab.com/gitlab-org/cli" },
} as const;

const SEGMENT =
  "h-5.5 rounded-full px-2.5 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/60";

function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-4.5 items-center gap-1 rounded-full px-2 text-[10.5px] font-semibold leading-none ${tone}`}
    >
      {children}
    </span>
  );
}

function ChecksChip({ checks }: { checks: Exclude<PullRequest["checks"], "none"> }) {
  const tone = CHECK_TONE[checks];
  return (
    <Chip tone={tone.chip}>
      {checks === "passing" && <CheckIcon size={9} />}
      {checks === "failing" && <CloseIcon size={9} />}
      {checks === "pending" && (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
      )}
      {tone.label}
    </Chip>
  );
}

function Row({ pull }: { pull: PullRequest }) {
  const state = PR_STATE[pull.state];
  const review = pull.review === null ? null : REVIEW_TONE[pull.review];
  return (
    <button
      type="button"
      data-pr-row
      onClick={() => openExternal(pull.url)}
      title={`Open on ${PROVIDER_NAME[pull.provider]}`}
      className="group grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-2.5 rounded-xl text-left transition-colors hover:bg-hover-glass focus-visible:ring-2 focus-visible:ring-primary/60 p-2.5"
    >
      <span role="img" aria-label={state.label} className={`mt-0.5 grid size-6 place-items-center rounded-lg ${state.tile}`}>
        <PullRequestStateIcon state={pull.state} size={13} />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="line-clamp-2 text-[12.5px] font-semibold leading-snug text-ink">
          <span className="mr-1.5 font-mono text-[10.5px] font-medium text-ink-dim">{pullRequestLabel(pull)}</span>
          {pull.title}
        </span>
        <span className="truncate font-mono text-[10.5px] text-ink-dim">
          {pull.headBranch} → {pull.baseBranch}
        </span>
        {(pull.checks !== "none" || review) && (
          <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {pull.checks !== "none" && <ChecksChip checks={pull.checks} />}
            {review && (
              <Chip tone={review.chip}>
                {pull.review === "approved" && <CheckIcon size={9} />}
                {review.label}
              </Chip>
            )}
          </span>
        )}
        <span className="truncate text-[11px] text-ink-dim">
          {pull.author && `${pull.author} · `}updated {formatAbsoluteDate(pull.updatedAt)}
        </span>
      </span>
      <ExternalIcon
        size={12}
        className="mt-1 text-ink-dim opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </button>
  );
}

function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }, (_, index) => index).map((index) => (
        <div key={index} aria-hidden="true" className="flex gap-2.5 motion-safe:animate-pulse p-2.5">
          <span className="mt-0.5 size-6 shrink-0 rounded-lg bg-ink/10" />
          <span className="flex flex-1 flex-col gap-2 pt-1">
            <span className="h-3 w-4/5 rounded-full bg-ink/10" />
            <span className="h-2.5 w-2/5 rounded-full bg-ink/10" />
          </span>
        </div>
      ))}
    </div>
  );
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-8 text-center">
      <span className="mb-1.5 grid size-8 place-items-center rounded-xl bg-ink/10 text-ink-dim">
        <PullRequestIcon size={15} />
      </span>
      <p className="m-0 text-[12.5px] font-semibold text-ink">{title}</p>
      <p className="m-0 text-[11.5px] leading-relaxed text-ink-dim">{hint}</p>
    </div>
  );
}

function Notice({ children, warn = false }: { children: ReactNode; warn?: boolean }) {
  return (
    <div className="m-1 flex items-start gap-2.5 rounded-xl border border-rule bg-sheet p-3">
      <span
        className={`mt-px grid size-6 shrink-0 place-items-center rounded-lg ${
          warn ? "bg-warning/15 text-warning-ink" : "bg-ink/10 text-ink-dim"
        }`}
      >
        <AlertIcon size={13} />
      </span>
      <p className="m-0 text-[12px] leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
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

  const { loadMore, showAll } = pulls;
  const feed = filter === "open" ? pulls.open : pulls.all;
  const shown = feed.pulls;
  const canObserve = typeof IntersectionObserver !== "undefined";
  const listRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  // The sentinel exists only while a page is waiting and nothing is in flight, so each landed
  // page re-arms the observer: it keeps loading until the list overflows the panel, then waits.
  const waiting = feed.cursor !== null && !feed.loadingMore && feed.moreError === null;

  useEffect(() => {
    const target = sentinel.current;
    if (!open || !waiting || !target || !canObserve) return;
    const observer = new IntersectionObserver(
      (hits) => {
        if (hits.some((hit) => hit.isIntersecting)) loadMore(filter);
      },
      { root: listRef.current, rootMargin: "240px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
    // `position` is in the list because the panel (and so the sentinel) mounts a render after `open`.
  }, [open, position, waiting, filter, loadMore, canObserve, shown.length]);

  if (pulls.status === "unsupported-remote") return null;

  const nouns = requestNoun(pulls.provider, true);
  const lower = nouns.toLowerCase();
  const cli = pulls.provider === null ? null : CLI[pulls.provider];
  // GitHub says how many there are; GitLab only whether another page may exist.
  const openCount = pulls.open.total ?? pulls.open.pulls.length;
  const openMore = pulls.open.total === null && pulls.open.cursor !== null;
  const openLabel = `${compactCount(openCount)}${openMore ? "+" : ""}`;
  const allLabel = pulls.all.loaded
    ? `${compactCount(pulls.all.total ?? pulls.all.pulls.length)}${pulls.all.total === null && pulls.all.cursor !== null ? "+" : ""}`
    : null;
  const firstLoad =
    filter === "open"
      ? pulls.status === null && pulls.error === null
      : pulls.status === "ok" && !pulls.all.loaded && pulls.all.moreError === null;

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
          openCount > 0
            ? `${openLabel} open ${requestNoun(pulls.provider, openCount !== 1).toLowerCase()}`
            : nouns
        }
        className={`${GLASS_CONTROL} relative grid place-items-center text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 size-7 ${
          open ? "border-primary-ink/40 bg-glass-strong text-ink soft-shadow" : ""
        }`}
      >
        <PullRequestIcon size={13} className={pulls.loading ? "animate-pulse" : undefined} />
        {openCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-success px-1 font-mono text-[9px] font-bold leading-none text-white soft-shadow"
          >
            {openCount > 9 ? "9+" : openCount}
          </span>
        )}
      </button>

      {open &&
        position &&
        createPortal(
          // Portaled to <body>: the title bar's backdrop blur would otherwise become the
          // containing block of this fixed panel and drag it out of place.
          <div
            ref={panel}
            role="dialog"
            aria-label={nouns}
            data-pr-panel
            style={{ top: position.top, right: position.right, transformOrigin: "top right" }}
            className={`${PANEL} pop-in-menu fixed z-50 flex max-h-[70vh] w-104 max-w-[calc(100vw-16px)] flex-col`}
          >
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <h2 className="m-0 text-[13px] font-bold tracking-tight text-ink">{nouns}</h2>
              <div className="flex items-center gap-1.5">
                <div
                  role="group"
                  aria-label={`Filter ${lower}`}
                  className="flex items-center gap-0.5 rounded-full border border-hairline bg-glass-soft p-0.5 backdrop-blur-md"
                >
                  {(["open", "all"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={filter === value}
                      onClick={() => {
                        setFilter(value);
                        if (value === "all") showAll();
                      }}
                      className={`${SEGMENT} ${
                        filter === value ? "bg-primary text-white" : "text-ink-dim hover:bg-hover-glass hover:text-ink"
                      }`}
                    >
                      {value === "open" ? "Open" : "All"}
                      {(value === "open" ? openLabel : allLabel) !== null && (
                        <span className="ml-1 font-mono font-medium opacity-80">
                          {value === "open" ? openLabel : allLabel}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={pulls.reload}
                  disabled={pulls.loading}
                  aria-label="Refresh"
                  title={pulls.loading ? "Loading…" : `Refresh ${lower}`}
                  className="grid size-6 place-items-center rounded-full text-ink-dim hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60"
                >
                  <RefreshIcon width={12} height={12} className={pulls.loading ? "motion-safe:animate-spin" : undefined} />
                </button>
              </div>
            </div>

            <div
              ref={listRef}
              className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto border-t border-rule p-1.5"
            >
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
                <Notice warn>
                  Could not read {lower}: {pulls.error}
                </Notice>
              )}
              {firstLoad && <SkeletonRows />}
              {pulls.status === "ok" && feed.loaded && shown.length === 0 && (
                <Empty
                  title={filter === "open" ? `No open ${lower}` : `No ${lower} yet`}
                  hint={
                    filter === "open"
                      ? "Merged and closed ones, if any, are under All."
                      : "Nothing has been opened for this repository."
                  }
                />
              )}
              {pulls.status === "ok" && shown.map((pull) => <Row key={pull.number} pull={pull} />)}
              {feed.loadingMore && <SkeletonRows count={1} />}
              {feed.moreError !== null && (
                <Notice warn>
                  Could not load {feed.loaded ? "more " : ""}
                  {lower}: {feed.moreError}{" "}
                  <button
                    type="button"
                    onClick={() => loadMore(filter)}
                    className="font-semibold text-primary-ink underline underline-offset-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    Retry
                  </button>
                </Notice>
              )}
              {waiting && (
                // The marker the observer watches; without an observer (old webview, jsdom) the
                // same page is one click away.
                <div ref={sentinel} className="flex justify-center py-1.5">
                  {!canObserve && (
                    <button
                      type="button"
                      onClick={() => loadMore(filter)}
                      className="rounded-full px-3 py-1 text-[11.5px] font-semibold text-ink-dim hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60"
                    >
                      Load more
                    </button>
                  )}
                </div>
              )}
              {feed.loaded && feed.cursor === null && shown.length > PR_PAGE_SIZE && (
                <p className="m-0 py-2 text-center text-[11px] text-ink-dim">That&apos;s all of them.</p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
