/**
 * The photo half of the avatar: Gravatar keyed by the SHA-256 of the email. Gravatar accepts
 * SHA-256 alongside legacy MD5, and WebCrypto gives us SHA-256 for free — no vendored md5.
 * Results are cached for the life of the session so one author costs exactly one image request.
 */

/**
 * Gravatar treats "Foo@Bar.com " and "foo@bar.com" as one person: the spec is to trim and
 * lowercase before hashing.
 */
function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The lowercase hex SHA-256 gravatar keys its lookup on, like `sha256("abc")` = `ba78…5ad`. */
export async function emailSha256Hex(email: string): Promise<string | undefined> {
  try {
    const data = new TextEncoder().encode(normalizedEmail(email));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // No secure context / no WebCrypto: the initials avatar still stands.
    return undefined;
  }
}

const photoUrlCache = new Map<string, Promise<string | null>>();

/** Emails whose d=404 probe came back empty: one wrong look-up per author per session, never more. */
const photoMissing = new Set<string>();

/** Answer every later row of this author without another network try with the same answer. */
export function notePhotoMissing(email: string): void {
  photoMissing.add(email.trim().toLowerCase());
}

/** Clear both caches — the tests reset state between runs. */
export function resetPhotoCache(): void {
  photoUrlCache.clear();
  photoMissing.clear();
}

/** URL to a 64px gravatar photo, or null when the author has none (d=404 makes that an error). */
export function gravatarPhotoUrl(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (photoMissing.has(normalized)) return Promise.resolve(null);

  const cached = photoUrlCache.get(normalized);
  if (cached) return cached;

  const pending = emailSha256Hex(normalized).then((hex) =>
    hex ? `https://www.gravatar.com/avatar/${hex}?s=64&d=404` : null,
  );
  // The entry stays whatever the image probe turns out to be; failures resolve to null below.
  photoUrlCache.set(normalized, pending);
  return pending;
}
