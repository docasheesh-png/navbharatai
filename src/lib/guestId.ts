// The anonymous device id a signed-out visitor's requests carry (admin 2026-09-27: "without login only
// 10 messages per day … sabhi mila kar").
//
// The server counts a visitor's daily AI messages against this id (src/server/lib/guestDailyQuota.ts),
// because an IP address is shared by many phones on Indian mobile networks. It is a random value minted
// on this device — no name, no account, nothing that identifies a person — and it is sent only while
// nobody is signed in; a signed-in request carries the account token instead.

/** Must match `GUEST_ID_HEADER` on the server. */
export const GUEST_ID_HEADER = 'x-nb-guest';
/** Must match `GUEST_LIMIT_CODE` on the server. */
export const GUEST_LIMIT_CODE = 'guest_limit_reached';

const STORAGE_KEY = 'nb_guest_id';
let memoryId: string | null = null;

function mint(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through */ }
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

/**
 * This device's guest id, created once and kept. Storage that throws (a private window, blocked site
 * data) falls back to one id for this page's life, so a visitor there is still counted consistently
 * until they reload.
 */
export function guestId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && /^[A-Za-z0-9-]{16,64}$/.test(saved)) return saved;
    const fresh = mint();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    if (!memoryId) memoryId = mint();
    return memoryId;
  }
}

/**
 * If this response is the server's "daily guest messages are used up" refusal, open sign-in and return the
 * sentence to show; otherwise `null`. Reads a CLONE, so a caller that gets `null` can still read the body.
 */
export async function guestLimitReached(res: Response): Promise<string | null> {
  if (res.status !== 403) return null;
  let body: { code?: unknown; error?: unknown } = {};
  try { body = await res.clone().json(); } catch { return null; }
  if (body.code !== GUEST_LIMIT_CODE) return null;
  openSignIn();
  return typeof body.error === 'string' && body.error
    ? body.error
    : 'You have used your free messages for today. Sign in to keep going — it is free — or come back tomorrow.';
}

/** The one event the whole app already uses to open the sign-in screen (App.tsx). */
export function openSignIn(): void {
  try {
    window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { signIn: 'phone' } }));
  } catch { /* no window (tests) — nothing to open */ }
}
