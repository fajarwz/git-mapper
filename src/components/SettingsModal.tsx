import { useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { SyntaxScheme } from "../lib/highlight";
import { GITHUB_URL, type UpdateMode, type UpdateStatus } from "../lib/updater";
import type { Theme } from "../lib/theme";
import { PANEL } from "../lib/ui";
import { CheckIcon, CloseIcon } from "./icons";

interface SettingsModalProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  /** The initials avatar beside the username in the commit list. */
  showAvatars: boolean;
  onShowAvatarsChange: (show: boolean) => void;
  syntaxScheme: SyntaxScheme;
  onSyntaxSchemeChange: (scheme: SyntaxScheme) => void;
  /** The running release version, from the Tauri runtime ("dev" in a plain browser). */
  appVersion: string;
  updateMode: UpdateMode;
  onUpdateModeChange: (mode: UpdateMode) => void;
  updateStatus: UpdateStatus;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onRestartToUpdate: () => void;
  onClose: () => void;
}

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Frosted white glass" },
  { value: "dark", label: "Dark", hint: "Smoked glass, low glare" },
];

const SYNTAX_SCHEMES: { value: SyntaxScheme; label: string; hint: string }[] = [
  { value: "app", label: "App", hint: "Tokens; follows the theme" },
  { value: "github", label: "GitHub", hint: "The github.com look" },
  { value: "neon", label: "Neon", hint: "One-Dark punch" },
];

interface UpdateAction {
  label: string;
  tone: "primary" | "ghost";
  disabled?: boolean;
}

/** The one button the update state wants, or null for states without an action. */
function updateAction(status: UpdateStatus): UpdateAction | null {
  switch (status.phase) {
    case "idle":
    case "current":
    case "error":
      return { label: "Check for updates", tone: "ghost" };
    case "available":
      return { label: "Download update", tone: "ghost" };
    case "downloading":
      return { label: "Downloading…", tone: "ghost", disabled: true };
    case "ready":
      return { label: "Restart to apply update", tone: "primary" };
    default:
      return null;
  }
}

function updateStatusLine(status: UpdateStatus): string {
  switch (status.phase) {
    case "unsupported":
      return "Updates are off while running from source.";
    case "idle":
      return "Not checked yet.";
    case "checking":
      return "Checking for updates…";
    case "current":
      return "You are on the latest version.";
    case "available":
      return `Version ${status.version} is available.`;
    case "downloading": {
      const percent =
        status.total ? ` ${Math.round(((status.received ?? 0) / status.total) * 100)}%` : "";
      return `Downloading version ${status.version}…${percent}`;
    }
    case "ready":
      return `Version ${status.version} is ready.`;
    case "error":
      return `Update failed: ${status.message ?? "unknown error"}`;
  }
}

function openGithub() {
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (inTauri) void openUrl(GITHUB_URL);
  else window.open(GITHUB_URL, "_blank", "noopener");
}

function ThemePreview({ theme }: { theme: Theme }) {
  // The previews mock a FIXED theme, so they use literal colours, not tokens: a token like
  // `ink` re-points with the app theme, which made the light preview's bar go white-on-white
  // (invisible) whenever the app itself sat in dark mode.
  const frame =
    theme === "dark" ? "border-white/15 bg-[#0b1018]" : "border-black/10 bg-white";
  const bar = theme === "dark" ? "bg-white/25" : "bg-black/15";

  return (
    <span className={`flex h-12 w-full items-end gap-1 rounded-lg border p-1.5 ${frame}`}>
      <span className="h-5 w-8 rounded bg-primary/70" />
      <span className={`h-3 w-6 rounded ${bar}`} />
      <span className="rounded-full bg-success/70 size-4" />
    </span>
  );
}

export function SettingsModal({
  theme,
  onThemeChange,
  showAvatars,
  onShowAvatarsChange,
  syntaxScheme,
  onSyntaxSchemeChange,
  appVersion,
  updateMode,
  onUpdateModeChange,
  updateStatus,
  onCheckForUpdates,
  onDownloadUpdate,
  onRestartToUpdate,
  onClose,
}: SettingsModalProps) {
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

        <div className="mt-3 rounded-xl border border-rule bg-sheet p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 text-[12px] font-semibold text-ink">Show avatars</p>
              <p className="m-0 text-[11px] leading-snug text-ink-dim">
                Photo from gravatar.com when the author has one, otherwise an initial tinted by
                email
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showAvatars}
              aria-label="Show avatars"
              title={showAvatars ? "Avatars are on" : "Avatars are off"}
              onClick={() => onShowAvatarsChange(!showAvatars)}
              className={`relative inline-flex h-5.5 w-10 shrink-0 cursor-default items-center rounded-full border border-hairline transition-colors ${
                showAvatars ? "bg-primary" : "bg-ink/15"
              }`}
            >
              <span
                className={`absolute left-0.5 size-4.5 rounded-full bg-white soft-shadow transition-transform ${
                  showAvatars ? "translate-x-4.5" : ""
                }`}
              />
            </button>
          </div>
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

        <div className="mt-3 flex gap-2" role="group" aria-label="Syntax colours">
          {SYNTAX_SCHEMES.map(({ value, label, hint }) => {
            const active = syntaxScheme === value;

            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => onSyntaxSchemeChange(value)}
                className={`flex flex-1 flex-col gap-1 rounded-xl border p-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${
                  active
                    ? "border-primary bg-primary/10 soft-shadow"
                    : "border-rule bg-sheet hover:bg-hover-glass"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-ink">{label}</span>
                  {active && <CheckIcon className="text-primary" />}
                </span>
                <span className="text-[11px] leading-snug text-ink-dim">{hint}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 rounded-xl border border-rule bg-sheet p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 text-[12px] font-semibold text-ink">Update automatically</p>
              <p className="m-0 text-[11px] leading-snug text-ink-dim">
                Download releases in the background at launch
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={updateMode === "auto"}
              aria-label="Update automatically"
              title={updateMode === "auto" ? "Automatic updates are on" : "Updates are manual"}
              onClick={() => onUpdateModeChange(updateMode === "auto" ? "manual" : "auto")}
              className={`relative inline-flex h-5.5 w-10 shrink-0 cursor-default items-center rounded-full border border-hairline transition-colors ${
                updateMode === "auto" ? "bg-primary" : "bg-ink/15"
              }`}
            >
              <span
                className={`absolute left-0.5 size-4.5 rounded-full bg-white soft-shadow transition-transform ${
                  updateMode === "auto" ? "translate-x-4.5" : ""
                }`}
              />
            </button>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span data-update-status className="min-w-0 text-[11.5px] leading-snug text-ink-dim">
              {updateStatusLine(updateStatus)}
            </span>
            {updateAction(updateStatus) && (
              <button
                type="button"
                onClick={() => {
                  if (updateStatus.phase === "ready") onRestartToUpdate();
                  else if (updateStatus.phase === "available") onDownloadUpdate();
                  else onCheckForUpdates();
                }}
                disabled={updateAction(updateStatus)!.disabled}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-60 ${
                  updateAction(updateStatus)!.tone === "primary"
                    ? "bg-primary text-white soft-shadow hover:brightness-110"
                    : "border border-hairline bg-glass-strong text-ink hover:bg-hover-glass"
                }`}
              >
                {updateAction(updateStatus)!.label}
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-rule bg-sheet p-3">
          <div className="min-w-0">
            <p className="m-0 text-[12px] font-semibold text-ink">
              Git Mapper
              {appVersion && (
                <span className="ml-1.5 font-mono text-[11px] font-medium text-ink-dim">
                  v{appVersion}
                </span>
              )}
            </p>
            <p className="m-0 text-[11px] leading-snug text-ink-dim">
              Built by fajarwz — a standalone Git history viewer
            </p>
          </div>
          <button
            type="button"
            onClick={() => openGithub()}
            title="Open the GitHub repository"
            className="shrink-0 rounded-lg border border-hairline bg-glass-strong px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-hover-glass"
          >
            GitHub
          </button>
        </div>

        <p className="m-0 mt-3 text-[10.5px] text-ink-dim">Settings are saved on this device.</p>
      </div>
    </div>
  );
}
