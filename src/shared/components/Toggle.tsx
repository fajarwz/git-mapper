interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  title?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, title, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full border border-hairline transition-colors focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-60 ${
        checked ? "bg-primary" : "bg-ink/15"
      }`}
    >
      <span
        className={`absolute left-0.5 size-4.5 rounded-full bg-white soft-shadow transition-transform ${
          checked ? "translate-x-4.5" : ""
        }`}
      />
    </button>
  );
}
