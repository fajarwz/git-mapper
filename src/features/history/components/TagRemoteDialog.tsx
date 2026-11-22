import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useExit } from "../../../shared/lib/useExit";
import { PANEL } from "../../../shared/lib/ui";
import { Button, ButtonVariant } from "../../../shared/components/Button";
import type { RemoteInfo } from "../../../types";

export enum TagRemoteMode {
  Push = "push",
  Delete = "delete",
}

interface TagRemoteDialogProps {
  mode: TagRemoteMode;
  tag: string;
  load: () => Promise<RemoteInfo[]>;
  onSubmit: (remote: string) => Promise<void>;
  onClose: () => void;
}

const COPY: Record<TagRemoteMode, { title: (tag: string) => string; action: string; variant: ButtonVariant; hint: string }> = {
  [TagRemoteMode.Push]: {
    title: (tag) => `Push tag ${tag}`,
    action: "Push tag",
    variant: ButtonVariant.Primary,
    hint: "A tag that already exists there with a different target is refused.",
  },
  [TagRemoteMode.Delete]: {
    title: (tag) => `Delete remote tag ${tag}?`,
    action: "Delete tag",
    variant: ButtonVariant.Danger,
    hint: "This removes the tag from that remote for everyone, not just you. Your local tag stays.",
  },
};

const FIELD =
  "mt-1.5 w-full rounded-lg border border-hairline bg-glass-strong px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-primary";

export function TagRemoteDialog({ mode, tag, load, onSubmit, onClose }: TagRemoteDialogProps) {
  const [remotes, setRemotes] = useState<RemoteInfo[] | null>(null);
  const [remote, setRemote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { leaving, close } = useExit(onClose);
  const copy = COPY[mode];

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    let live = true;
    load()
      .then((list) => {
        if (!live) return;
        setRemotes(list);
        setRemote(list.some((item) => item.name === "origin") ? "origin" : (list[0]?.name ?? ""));
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
    if (!remote || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(remote);
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
        aria-labelledby="tag-remote-title"
        onSubmit={(event) => void submit(event)}
        className={`${PANEL} w-full max-w-md p-5 ${leaving ? "pop-out" : "pop-in"}`}
      >
        <h2 id="tag-remote-title" className="m-0 text-[16px] font-bold tracking-tight text-ink">
          {copy.title(tag)}
        </h2>
        {remotes?.length === 0 ? (
          <p className="m-0 mt-3 text-[12.5px] text-ink-dim">This repository has no remotes. Add one first.</p>
        ) : (
          <>
            <label htmlFor="tag-remote" className="mb-0 mt-3 block text-[12.5px] text-ink-dim">
              Remote
            </label>
            <select
              id="tag-remote"
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
          <Button type="submit" variant={copy.variant} disabled={busy || !remote}>
            {copy.action}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
