/**
 * The offline avatar: a small circle with the author's initial, tinted by a hue derived from the
 * author's email. Every git client that wants avatars without a service reaches for this shape —
 * git itself carries no picture, only name + email, so the email becomes the one input the look
 * can be deterministic about. No network, no emails sent anywhere; a platform photo (Gravatar /
 * GitHub) can later sit behind the same prop.
 */
import { LINE_COLOR_COUNT } from "../lib/graphLanes";

/** Colour slot for an author: a stable hash of the email, spread over the lane palette. */
export function avatarColorIndex(email: string): number {
  // djb2 — small, stable across sessions, and even one different character reshuffles the tint.
  let hash = 5381;
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) + hash + email.charCodeAt(i)) | 0;
  }
  return (hash >>> 0) % LINE_COLOR_COUNT;
}

/** The initial the avatar shows: the first letter of the name, or a dot when the name is bare. */
export function avatarInitial(name: string): string {
  const first = name.trim().charAt(0);
  return first ? first.toUpperCase() : "·";
}

interface AvatarProps {
  name: string;
  email: string;
}

export function Avatar({ name, email }: AvatarProps) {
  // Mixed into the lane colour so both themes carry it and neighbouring authors mostly differ.
  const tone = `var(--color-lane-${avatarColorIndex(email) + 1})`;
  return (
    <span
      aria-hidden="true"
      className="grid size-5 shrink-0 place-items-center rounded-full font-mono text-[10px] font-bold"
      style={{
        backgroundColor: `color-mix(in oklab, ${tone} 22%, transparent)`,
        color: tone,
      }}
    >
      {avatarInitial(name)}
    </span>
  );
}
