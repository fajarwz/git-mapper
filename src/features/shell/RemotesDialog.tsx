import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useExit } from "../../shared/lib/useExit";
import { PANEL } from "../../shared/lib/ui";
import { Button, ButtonVariant } from "../../shared/components/Button";
import type { RemoteInfo } from "../../types";

interface RemotesDialogProps {
  load: () => Promise<RemoteInfo[]>;
  onAdd: (name: string, url: string) => Promise<void>;
  onRename: (name: string, next: string) => Promise<void>;
  onRemove: (name: string) => Promise<void>;
  onClose: () => void;
}

const FIELD =
  "w-full rounded-lg border border-hairline bg-glass-strong px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-primary";

/**
 * Manage the repository's remotes: list, add, rename, remove. The dialog owns the list and
 * reloads it after every change; the backend's refusals (a taken or invalid name, a bad URL)
 * come back as the thrown message and show inline. Removing asks a second time in the row,
 * because it also drops the remote's tracking branches.
 */
export function RemotesDialog({ load, onAdd, onRename, onRemove, onClose }: RemotesDialogProps) {
  const [remotes, setRemotes] = useState<RemoteInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const { leaving, close } = useExit(onClose);

  const reload = useCallback(async () => {
    try {
      setRemotes(await load());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setRemotes((current) => current ?? []);
    }
  }, [load]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    void reload();
    return () => returnFocusRef.current?.focus();
  }, [reload]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  async function run(action: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !url.trim()) return;
    if (await run(() => onAdd(name.trim(), url.trim()))) {
      setName("");
      setUrl("");
      nameRef.current?.focus();
    }
  }

  async function submitRename(event: FormEvent, from: string) {
    event.preventDefault();
    if (!renameTo.trim() || renameTo.trim() === from) {
      setRenaming(null);
      return;
    }
    if (await run(() => onRename(from, renameTo.trim()))) setRenaming(null);
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-40 grid place-items-center bg-scrim p-6 backdrop-blur-md ${leaving ? "fade-out" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remotes-title"
        className={`${PANEL} w-full max-w-lg p-5 ${leaving ? "pop-out" : "pop-in"}`}
      >
        <h2 id="remotes-title" className="m-0 text-[16px] font-bold tracking-tight text-ink">
          Remotes
        </h2>

        <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
          {remotes === null && <li className="text-[12.5px] text-ink-dim">Loading…</li>}
          {remotes?.length === 0 && <li className="text-[12.5px] text-ink-dim">This repository has no remotes.</li>}
          {remotes?.map((remote) => (
            <li
              key={remote.name}
              className="flex items-center gap-2 rounded-lg border border-hairline bg-glass-soft px-2.5 py-1.5"
            >
              {renaming === remote.name ? (
                <form onSubmit={(event) => void submitRename(event, remote.name)} className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    aria-label={`New name for ${remote.name}`}
                    value={renameTo}
                    onChange={(event) => setRenameTo(event.target.value)}
                    autoFocus
                    spellCheck={false}
                    autoComplete="off"
                    className={FIELD}
                  />
                  <Button type="submit" variant={ButtonVariant.Primary} disabled={busy}>
                    Save
                  </Button>
                  <Button onClick={() => setRenaming(null)}>Cancel</Button>
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-ink">{remote.name}</div>
                    <div className="truncate font-mono text-[11.5px] text-ink-dim" title={remote.url}>
                      {remote.url}
                    </div>
                  </div>
                  {removing === remote.name ? (
                    <>
                      <span className="text-[12px] text-ink-dim">Remove it and its tracking branches?</span>
                      <Button
                        variant={ButtonVariant.Danger}
                        disabled={busy}
                        onClick={() =>
                          void run(() => onRemove(remote.name)).then(() => setRemoving(null))
                        }
                      >
                        Remove {remote.name}
                      </Button>
                      <Button onClick={() => setRemoving(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <Button
                        aria-label={`Rename ${remote.name}`}
                        onClick={() => {
                          setRenaming(remote.name);
                          setRenameTo(remote.name);
                          setRemoving(null);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        aria-label={`Remove ${remote.name}`}
                        onClick={() => {
                          setRemoving(remote.name);
                          setRenaming(null);
                        }}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>

        <form onSubmit={(event) => void submitAdd(event)} className="mt-4 flex flex-col gap-1.5">
          <label htmlFor="remote-name" className="text-[12.5px] text-ink-dim">
            Add a remote
          </label>
          <div className="flex gap-2">
            <input
              id="remote-name"
              ref={nameRef}
              aria-label="Remote name"
              placeholder="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              className={`${FIELD} max-w-32`}
            />
            <input
              aria-label="Remote URL"
              placeholder="https://… or git@…"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              className={FIELD}
            />
            <Button type="submit" variant={ButtonVariant.Primary} disabled={busy || !name.trim() || !url.trim()}>
              Add
            </Button>
          </div>
        </form>

        {error && (
          <p role="alert" className="m-0 mt-2 text-[12px] text-danger-ink">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <Button onClick={close}>Close</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
