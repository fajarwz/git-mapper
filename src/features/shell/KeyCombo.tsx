interface KeyComboProps {
  keys: string[];
  className?: string;
}

/** A key chord drawn as one box per key, e.g. [Ctrl] [T]. */
export function KeyCombo({ keys, className = "" }: KeyComboProps) {
  return (
    <span role="group" aria-label={keys.join("+")} className={`inline-flex items-center gap-1 ${className}`}>
      {keys.map((key) => (
        <kbd
          key={key}
          aria-hidden
          className="rounded-md border border-hairline bg-glass-strong px-1.5 py-px font-sans text-[10.5px] font-medium leading-4 text-ink"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
