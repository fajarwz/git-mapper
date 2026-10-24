import { useEffect, useRef } from "react";
import type { Theme } from "../lib/theme";
import { PANEL } from "../lib/ui";
import { CheckIcon, CloseIcon } from "./icons";

interface SettingsModalProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onClose: () => void;
}

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Frosted white glass" },
  { value: "dark", label: "Dark", hint: "Smoked glass, low glare" },
];

function ThemePreview({ theme }: { theme: Theme }) {
  const frame =
    theme === "dark" ? "border-white/15 bg-[#0b1018]" : "border-ink/10 bg-white";
  const bar = theme === "dark" ? "bg-white/25" : "bg-ink/15";

  return (
    <span className={`flex h-12 w-full items-end gap-1 rounded-lg border p-1.5 ${frame}`}>
      <span className="h-5 w-8 rounded bg-primary/70" />
      <span className={`h-3 w-6 rounded ${bar}`} />
      <span className="rounded-full bg-success/70 size-4" />
    </span>
  );
}

export function SettingsModal({ theme, onThemeChange, onClose }: SettingsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Move focus into the dialog, and hand it back to the trigger when the dialog closes.
  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-scrim p-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className={`${PANEL} w-full max-w-md p-5`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="settings-title" className="m-0 text-[16px] font-bold tracking-tight text-ink">
              Settings
            </h2>
            <p className="m-0 mt-0.5 text-[11.5px] text-ink-dim">Appearance</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="grid shrink-0 cursor-default place-items-center rounded-full text-ink-dim hover:bg-sheet-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 size-7"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="mt-4 flex gap-2" role="group" aria-label="Theme">
          {THEMES.map(({ value, label, hint }) => {
            const active = theme === value;

            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => onThemeChange(value)}
                className={`flex flex-1 flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${
                  active
                    ? "border-primary bg-primary/10 soft-shadow"
                    : "border-rule bg-sheet hover:bg-hover-glass"
                }`}
              >
                <ThemePreview theme={value} />
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-ink">{label}</span>
                  {active && <CheckIcon className="text-primary" />}
                </span>
                <span className="text-[11px] leading-snug text-ink-dim">{hint}</span>
              </button>
            );
          })}
        </div>

        <p className="m-0 mt-3 text-[10.5px] text-ink-dim">Theme is saved on this device.</p>
      </div>
    </div>
  );
}
