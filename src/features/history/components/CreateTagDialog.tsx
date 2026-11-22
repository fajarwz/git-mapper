import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useExit } from "../../../shared/lib/useExit";
import { PANEL } from "../../../shared/lib/ui";
import { Button, ButtonVariant } from "../../../shared/components/Button";
import { Toggle } from "../../../shared/components/Toggle";

interface CreateTagDialogProps {
  hash: string;
  exists: (name: string) => Promise<boolean>;
  /** An empty message means a lightweight tag. */
  onCreate: (name: string, message: string) => void;
  onClose: () => void;
}

export function CreateTagDialog({ hash, exists, onCreate, onClose }: CreateTagDialogProps) {
  const [name, setName] = useState("");
  const [annotated, setAnnotated] = useState(false);
  const [message, setMessage] = useState("");
  const [taken, setTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { leaving, close } = useExit(onClose);
  const trimmed = name.trim();
  const needsMessage = annotated && !message.trim();

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || needsMessage || busy) return;
    setBusy(true);
    try {
      if (await exists(trimmed)) setTaken(true);
      else onCreate(trimmed, annotated ? message.trim() : "");
    } finally {
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
        aria-labelledby="create-tag-title"
        onSubmit={submit}
        className={`${PANEL} w-full max-w-md p-5 ${leaving ? "pop-out" : "pop-in"}`}
      >
        <h2 id="create-tag-title" className="m-0 text-[16px] font-bold tracking-tight text-ink">
          Create tag at {hash.slice(0, 8)}
        </h2>
        <label htmlFor="create-tag-name" className="mb-0 mt-2 block text-[12.5px] text-ink-dim">
          Tag name
        </label>
        <input
          id="create-tag-name"
          ref={inputRef}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setTaken(false);
          }}
          aria-invalid={taken}
          spellCheck={false}
          autoComplete="off"
          className="mt-1.5 w-full rounded-lg border border-hairline bg-glass-strong px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-primary"
        />
        {taken && (
          <p role="alert" className="m-0 mt-1.5 text-[12px] text-danger-ink">
            A tag named {trimmed} already exists.
          </p>
        )}
        <label className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-ink-dim">
          Annotated tag (with a message)
          <Toggle checked={annotated} onChange={setAnnotated} label="Annotated tag" />
        </label>
        {annotated && (
          <>
            <label htmlFor="create-tag-message" className="mb-0 mt-2 block text-[12.5px] text-ink-dim">
              Tag message
            </label>
            <textarea
              id="create-tag-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              className="mt-1.5 w-full resize-none rounded-lg border border-hairline bg-glass-strong px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-primary"
            />
          </>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant={ButtonVariant.Primary} disabled={!trimmed || needsMessage || busy}>
            Create tag
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
