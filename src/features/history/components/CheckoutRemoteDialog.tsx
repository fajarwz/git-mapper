import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { RemoteCheckoutMode } from "../../../types";
import { useExit } from "../../../shared/lib/useExit";
import { PANEL } from "../../../shared/lib/ui";
import { Button, ButtonVariant } from "../../../shared/components/Button";
import { localNameOfRemote } from "../../../shared/lib/remoteBranch";

interface CheckoutRemoteDialogProps {
  remoteRef: string;
  exists: (name: string) => Promise<boolean>;
  onCheckout: (name: string, mode: RemoteCheckoutMode) => void;
  onClose: () => void;
}

export function CheckoutRemoteDialog({ remoteRef, exists, onCheckout, onClose }: CheckoutRemoteDialogProps) {
  const [name, setName] = useState(localNameOfRemote(remoteRef));
  const [clash, setClash] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { leaving, close } = useExit(onClose);
  const trimmed = name.trim();

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select();
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
      if (await exists(trimmed)) setClash(true);
      else onCheckout(trimmed, RemoteCheckoutMode.Create);
    } finally {
      setBusy(false);
    }
  }

  function chooseAnotherName() {
    setClash(false);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
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
        aria-labelledby="checkout-remote-title"
        onSubmit={submit}
        className={`${PANEL} w-full max-w-md p-5 ${leaving ? "pop-out" : "pop-in"}`}
      >
        <h2 id="checkout-remote-title" className="m-0 text-[16px] font-bold tracking-tight text-ink">
          Check out {remoteRef}
        </h2>
        {clash ? (
          <p className="mb-0 mt-2 text-[12.5px] leading-relaxed text-ink-dim">
            A local branch named <span className="font-semibold text-ink">{trimmed}</span> already
            exists. Check it out and pull <span className="font-semibold text-ink">{remoteRef}</span>{" "}
            into it, or use another name for a new branch.
          </p>
        ) : (
          <>
            <label htmlFor="checkout-remote-name" className="mb-0 mt-2 block text-[12.5px] text-ink-dim">
              Name of the new local branch
            </label>
            <input
              id="checkout-remote-name"
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              className="mt-1.5 w-full rounded-lg border border-hairline bg-glass-strong px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-primary"
            />
          </>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          {clash ? (
            <>
              <Button onClick={chooseAnotherName}>Use another name</Button>
              <Button
                variant={ButtonVariant.Primary}
                autoFocus
                onClick={() => onCheckout(trimmed, RemoteCheckoutMode.Existing)}
              >
                Check out existing &amp; pull
              </Button>
            </>
          ) : (
            <Button type="submit" variant={ButtonVariant.Primary} disabled={!trimmed || busy}>
              Check out
            </Button>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}
