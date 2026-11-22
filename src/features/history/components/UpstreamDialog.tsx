import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useExit } from "../../../shared/lib/useExit";
import { PANEL } from "../../../shared/lib/ui";
import { Button, ButtonVariant } from "../../../shared/components/Button";
import type { RemoteInfo } from "../../../types";

export enum UpstreamMode {
  Set = "set",
  Push = "push",
}

interface UpstreamDialogProps {
  mode: UpstreamMode;
  branch: string;
  /** The remote preselected in the picker, usually the branch's current one. */
  defaultRemote: string;
  load: () => Promise<RemoteInfo[]>;
  onSubmit: (remote: string, remoteBranch: string) => Promise<void>;
  onClose: () => void;
}

const COPY: Record<UpstreamMode, { title: (branch: string) => string; action: string; hint: string }> = {
  [UpstreamMode.Set]: {
    title: (branch) => `Set upstream for ${branch}`,
    action: "Set upstream",
    hint: "The branch has to exist on the remote already. Fetch first if it was just created there.",
  },
  [UpstreamMode.Push]: {
    title: (branch) => `Push ${branch} to…`,
    action: "Push",
    hint: "Publishes the branch under this name and makes it the upstream.",
  },
};

const FIELD =
  "mt-1.5 w-full rounded-lg border border-hairline bg-glass-strong px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-primary";

export function UpstreamDialog({ mode, branch, defaultRemote, load, onSubmit, onClose }: UpstreamDialogProps) {
  const [remotes, setRemotes] = useState<RemoteInfo[] | null>(null);
  const [remote, setRemote] = useState(defaultRemote);
  const [remoteBranch, setRemoteBranch] = useState(branch);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { leaving, close } = useExit(onClose);
  const copy = COPY[mode];
  const target = remoteBranch.trim();

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    let live = true;
    load()
      .then((list) => {
        if (!live) return;
        setRemotes(list);
        setRemote((current) => (list.some((item) => item.name === current) ? current : (list[0]?.name ?? "")));
      })
      .catch((loadError: unknown) => {
        if (!live) return;
        setRemotes([]);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => {
      live = false;
      returnFocusRef.current?.focus();
    };
  }, [load]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!remote || !target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(remote, target);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-40 grid place-items-center bg-scrim p-6 backdrop-blur-md ${leaving ? "fade-out" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="upstream-title"
        onSubmit={(event) => void submit(event)}
        className={`${PANEL} w-full max-w-md p-5 ${leaving ? "pop-out" : "pop-in"}`}
      >
        <h2 id="upstream-title" className="m-0 text-[16px] font-bold tracking-tight text-ink">
          {copy.title(branch)}
        </h2>
        {remotes?.length === 0 ? (
          <p className="m-0 mt-3 text-[12.5px] text-ink-dim">This repository has no remotes. Add one first.</p>
        ) : (
          <>
            <label htmlFor="upstream-remote" className="mb-0 mt-3 block text-[12.5px] text-ink-dim">
              Remote
            </label>
            <select
              id="upstream-remote"
              value={remote}
              onChange={(event) => setRemote(event.target.value)}
              disabled={remotes === null}
              className={FIELD}
            >
              {remotes?.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
            <label htmlFor="upstream-branch" className="mb-0 mt-3 block text-[12.5px] text-ink-dim">
              Remote branch
            </label>
            <input
              id="upstream-branch"
              value={remoteBranch}
              onChange={(event) => {
                setRemoteBranch(event.target.value);
                setError(null);
              }}
              spellCheck={false}
              autoComplete="off"
              className={FIELD}
            />
            <p className="m-0 mt-1.5 text-[12px] text-ink-dim">{copy.hint}</p>
          </>
        )}
        {error && (
          <p role="alert" className="m-0 mt-2 text-[12px] text-danger-ink">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant={ButtonVariant.Primary} disabled={busy || !remote || !target}>
            {copy.action}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
