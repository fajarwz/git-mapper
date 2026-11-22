import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useExit } from "../../../shared/lib/useExit";
import { PANEL } from "../../../shared/lib/ui";
import { Button, ButtonVariant } from "../../../shared/components/Button";

interface CreateBranchDialogProps {
  hash: string;
  exists: (name: string) => Promise<boolean>;
  onCreate: (name: string, checkout: boolean) => void;
  onClose: () => void;
}

export function CreateBranchDialog({ hash, exists, onCreate, onClose }: CreateBranchDialogProps) {
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);
  const [taken, setTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { leaving, close } = useExit(onClose);
  const trimmed = name.trim();

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
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      if (await exists(trimmed)) setTaken(true);
      else onCreate(trimmed, checkout);
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
        aria-labelledby="create-branch-title"
        onSubmit={submit}
        className={`${PANEL} w-full max-w-md p-5 ${leaving ? "pop-out" : "pop-in"}`}
      >
        <h2 id="create-branch-title" className="m-0 text-[16px] font-bold tracking-tight text-ink">
          Create branch at {hash.slice(0, 8)}
        </h2>
        <label htmlFor="create-branch-name" className="mb-0 mt-2 block text-[12.5px] text-ink-dim">
          Branch name
        </label>
        <input
          id="create-branch-name"
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
            A branch named {trimmed} already exists.
          </p>
        )}
        <label className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-dim">
          <input type="checkbox" checked={checkout} onChange={(event) => setCheckout(event.target.checked)} />
          Check out the new branch
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant={ButtonVariant.Primary} disabled={!trimmed || busy}>
            Create branch
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
