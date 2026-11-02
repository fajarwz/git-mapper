/**
 * The avatar: a small circle left of the username. Base layer is the offline initials chip (a
 * hue derived from the email — git carries no picture, just name + email); when a photo is
 * wanted, the author's gravatar.com photo fades in over it, and a missing photo or no network
 * silently leaves the initials. This is the two-tier shape every serious client uses.
 */
import { useEffect, useRef, useState } from "react";
import { LINE_COLOR_COUNT } from "../lib/graphLanes";
import { gravatarPhotoUrl, notePhotoMissing } from "../lib/avatarPhoto";

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
  // A row with no author has nobody to picture: the uncommitted-changes row carries an empty
  // name and email, and an empty tinted circle there read as a broken image. Hooks below still
  // run unconditionally, so switching the selected commit never changes hook order.
  const anonymous = name.trim() === "" && email.trim() === "";
  // Mixed into the lane colour so both themes carry it and neighbouring authors mostly differ.
  const tone = `var(--color-lane-${avatarColorIndex(email) + 1})`;
  const tint = { backgroundColor: `color-mix(in oklab, ${tone} 22%, transparent)`, color: tone };
  // The resolved photo is stapled to the email it belongs to: switching commits (a new email
  // on the same component instance) must never keep painting the previous author's photo.
  const [resolved, setResolved] = useState<{ email: string; url: string } | null>(null);
  const [photoShown, setPhotoShown] = useState(false);
  // The stale-guard: a photo resolving after the email prop changed must not paint over it.
  const wantedRef = useRef("");

  useEffect(() => {
    if (anonymous || !photos) return;
    const wanted = email;
    wantedRef.current = wanted;
    void gravatarPhotoUrl(email).then((url) => {
      if (wantedRef.current !== wanted || !url) return;
      setPhotoShown(false);
      setResolved({ email: wanted, url });
    });
  }, [photos, email]);

  const activePhoto = resolved?.email === email ? resolved : null;

  if (anonymous) return null;

  return (
    <span
      aria-hidden="true"
      className="relative grid size-5 shrink-0 place-items-center overflow-hidden rounded-full font-mono text-[10px] font-bold"
      style={tint}
    >
      {avatarInitial(name)}
      {activePhoto && (
        <img
          key={activePhoto.email}
          src={activePhoto.url}
          alt=""
          className={`absolute inset-0 size-full object-cover ${photoShown ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setPhotoShown(true)}
          onError={() => {
            // No gravatar for this email (d=404) or the request fell over: keep the initials,
            // record the miss so other rows of this author never retry, and drop the dead <img>.
            notePhotoMissing(email);
            wantedRef.current = "";
            setResolved(null);
            setPhotoShown(false);
          }}
        />
      )}
    </span>
  );
}
