interface IconProps {
  size?: number;
}

export function BranchIcon({ size = 12 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="4" cy="3.5" r="1.8" />
      <circle cx="4" cy="12.5" r="1.8" />
      <circle cx="12" cy="5.5" r="1.8" />
      <path d="M4 5.3v5.4" />
      <path d="M12 7.3c0 2.7-3.4 3-6.5 3.7" />
    </svg>
  );
}

export function TagIcon({ size = 12 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.4 2.4h5.1l6.1 6.1-5.1 5.1-6.1-6.1z" />
      <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RemoteIcon({ size = 12 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.6 12.2h6.9a2.6 2.6 0 0 0 .3-5.1 3.6 3.6 0 0 0-6.9-.9 2.9 2.9 0 0 0-.3 6Z" />
    </svg>
  );
}

export function RepoIcon({ size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.3 3.2h4l1.6 2h5.8v7.6H2.3z" />
      <path d="M2.3 7.6h11.4" />
    </svg>
  );
}

export function PlusIcon({ size = 12 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 3.2v9.6M3.2 8h9.6" />
    </svg>
  );
}

interface GlyphProps {
  size?: number;
  className?: string;
}

export function ChevronDownIcon({ size = 12, className = "" }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6.5 8 10.5l4-4" />
    </svg>
  );
}

export function CloseIcon({ size = 12, className = "" }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function SettingsIcon({ size = 14, className = "" }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2.5 5h11M2.5 11h11" />
      <circle cx="6" cy="5" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="11" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CheckIcon({ size = 12, className = "" }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}
