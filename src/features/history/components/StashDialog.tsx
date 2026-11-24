import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useExit } from "../../../shared/lib/useExit";
import { PANEL } from "../../../shared/lib/ui";
import { Button, ButtonVariant } from "../../../shared/components/Button";

interface StashDialogProps {
  /** An empty message means git's own default name ("WIP on <branch>: …"). */
  onStash: (message: string) => void;
  onClose: () => void;
}

export function StashDialog({ onStash, onClose }: StashDialogProps) {
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { leaving, close } = useExit(onClose);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onStash(message.trim());
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
        aria-labelledby="stash-title"
        onSubmit={submit}
        className={`${PANEL} w-full max-w-md p-5 ${leaving ? "pop-out" : "pop-in"}`}
      >
        <h2 id="stash-title" className="m-0 text-[16px] font-bold tracking-tight text-ink">
          Stash changes
        </h2>
        <p className="m-0 mt-2 text-[12.5px] text-ink-dim">
          Every uncommitted change, untracked files included, is shelved and the working tree
          goes back to the last commit.
        </p>
        <label htmlFor="stash-message" className="mb-0 mt-3 block text-[12.5px] text-ink-dim">
          Name (optional)
        </label>
        <input
          id="stash-message"
          ref={inputRef}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="WIP on current branch"
          spellCheck={false}
          autoComplete="off"
          className="mt-1.5 w-full rounded-lg border border-hairline bg-glass-strong px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-dim/60 focus:border-primary"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant={ButtonVariant.Primary}>
            Stash
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
