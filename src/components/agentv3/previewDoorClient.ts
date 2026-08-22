// THE CLIENT'S SIDE OF THE PREVIEW DOOR — when to keep, replace, or drop the minted link.
//
// WHY THIS EXISTS (hand-triage of the pre-merge review, 2026-08-22). The health poll mints a FRESH
// door link every ~150 seconds, and each mint has a different expiry — so its query string differs.
// The first client naively adopted every mint, which made the iframe src a new string on every poll:
// React remounts the frame, and the user's running app RELOADS every 150 seconds and on every window
// refocus, losing whatever state they had in it. It also reset the waiting page's retry counter
// (keyed on the query string), quietly undoing the money cap.
//
// The rule, stated once and tested: ADOPT the first link, KEEP it while it is fresh, REPLACE it only
// near expiry (a tab open for most of a day must not decay into a dead frame), and DROP it the moment
// the server stops offering one (kill switch / rollback), so the frame falls back to the stored
// address instead of sticking on a link the server will now refuse. PURE.

/** Replace the held link when it has less than this long left to live. */
export const DOOR_REFRESH_WINDOW_MS = 60 * 60 * 1000;

/** The exp query param of a door link, or null when it cannot be read. */
export function doorLinkExpiry(doorUrl: string | null | undefined): number | null {
  const raw = String(doorUrl ?? '');
  const q = raw.indexOf('?');
  if (q < 0) return null;
  const exp = Number(new URLSearchParams(raw.slice(q + 1)).get('exp'));
  return Number.isFinite(exp) && exp > 0 ? exp : null;
}

/**
 * Which door link the frame should hold after a health answer.
 *
 * `next` empty means the server stopped offering one — the answer is then '' (fall back), never the
 * stale `prev`: a link the server has stopped minting is a link the server may now refuse, and a
 * frame stuck on a refused page with a working fallback in hand is the kill-switch trap this closes.
 */
export function nextDoorUrl(prev: string, next: string, now: number): string {
  if (!next) return '';
  if (!prev) return next;
  const exp = doorLinkExpiry(prev);
  // An unreadable expiry on the held link means we cannot prove it is still fresh — replace it.
  if (exp === null) return next;
  return exp - now < DOOR_REFRESH_WINDOW_MS ? next : prev;
}
