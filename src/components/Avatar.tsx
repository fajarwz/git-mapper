/**
 * The avatar: a small circle left of the username. Base layer is the offline initials chip (a
 * hue derived from the email — git carries no picture, just name + email); when a photo is
 * wanted, the author's gravatar.com photo fades in over it, and a missing photo or no network
 * silently leaves the initials. This is the two-tier shape every serious client uses.
 */
import { useEffect, useRef, useState } from "react";
import { LINE_COLOR_COUNT } from "../lib/graphLanes";
import { gravatarPhotoUrl } from "../lib/avatarPhoto";

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
  /** Photos load from gravatar.com; off means the initials chip alone. The setting owns this. */
  photos?: boolean;
}

export function Avatar({ name, email, photos = false }: AvatarProps) {
  // Mixed into the lane colour so both themes carry it and neighbouring authors mostly differ.
  const tone = `var(--color-lane-${avatarColorIndex(email) + 1})`;
  const tint = { backgroundColor: `color-mix(in oklab, ${tone} 22%, transparent)`, color: tone };
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoShown, setPhotoShown] = useState(false);
  // The stale-guard: a photo resolving after the email prop changed must not paint over it.
  const wantedRef = useRef("");

  useEffect(() => {
    if (!photos || photoUrl) return;
    const wanted = email;
    wantedRef.current = wanted;
    void gravatarPhotoUrl(email).then((url) => {
      if (wantedRef.current === wanted && url) setPhotoUrl(url);
    });
  }, [photos, email, photoUrl]);

  return (
    <span
      aria-hidden="true"
      className="relative grid size-5 shrink-0 place-items-center overflow-hidden rounded-full font-mono text-[10px] font-bold"
      style={tint}
    >
      {avatarInitial(name)}
      {photoUrl && (
        <img
          src={photoUrl}
          alt=""
          className={`absolute inset-0 size-full object-cover ${photoShown ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setPhotoShown(true)}
          onError={() => {
            // No gravatar for this email (d=404) or the request fell over: keep the initials,
            // drop the URL so the dead <img> does not sit in every row of the same author.
            wantedRef.current = "";
            setPhotoUrl(null);
            setPhotoShown(false);
          }}
        />
      )}
    </span>
  );
}
