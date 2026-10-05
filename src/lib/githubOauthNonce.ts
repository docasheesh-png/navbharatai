// A GITHUB TOKEN IS ACCEPTED ONLY FOR A SIGN-IN THIS APP STARTED (Q-623 web, Q-629 native).
//
// THE FINDING (forensic audit 2026-10-04, P1). App.tsx stored ANY `#gh_token=` fragment it was handed.
// A link `https://navbharatai.com/#gh_token=<attacker token>` therefore planted the attacker's GitHub
// token in the victim's session, and the victim's later pushes landed in the attacker's account. The
// same shape existed on the phone: any `com.navbharat.ai://github-callback#gh_token=…` link was stored.
//
// THE FIX is one rule, decided here and nowhere else: before a sign-in starts, this module makes a
// one-time nonce and keeps it; the server signs it into the OAuth `state` and echoes it back; a token is
// accepted only when the echoed nonce equals the saved one, and the saved one is then deleted. Nobody
// else can know a nonce that lives only in this tab (web) or this app (native).
//
//   web    → sessionStorage, compared on return (the nonce comes back beside the token);
//   native → localStorage (app-private; survives Android killing the WebView behind the browser), and
//            presented to the server to redeem the ticket — the deep link never carries the token.
//
// PURE apart from the two tiny storage accessors at the bottom — every decision is a function of its
// arguments, so it is testable without a browser.

/** Header the nonce travels in. A header, not a query string, so it is not written into request logs. */
export const GITHUB_NONCE_HEADER = 'X-NBAI-GitHub-Nonce';

/** Where the web flow keeps its nonce: this tab only. */
export const GITHUB_WEB_NONCE_KEY = 'nbai.ghOauthNonce';

/** Where the native flow keeps its device nonce. */
export const GITHUB_DEVICE_NONCE_KEY = 'nbai.ghDeviceNonce';

/** A saved nonce older than this is dead — the server's signed state expires after 10 minutes. */
export const NONCE_MAX_AGE_MS = 15 * 60 * 1000;

/** The subset of Web Storage used here, so tests can pass a plain object. */
export interface NonceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const NONCE_RE = /^[a-f0-9]{64}$/;

/** 32 random bytes as lowercase hex — the exact shape the server accepts. */
export function newOauthNonce(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  return Array.from(random(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Start an attempt: make a nonce, save it, and return the header that carries it to the server.
 * Throws when storage is unusable — a sign-in whose return cannot be verified must not start at all.
 */
export function beginGithubOauthAttempt(
  storage: NonceStorage | null,
  key: string,
  nowMs: number,
  nonce: string = newOauthNonce(),
): Record<string, string> {
  if (!storage) throw new Error('GitHub sign-in needs browser storage, which is turned off here.');
  storage.setItem(key, JSON.stringify({ n: nonce, at: nowMs }));
  return { [GITHUB_NONCE_HEADER]: nonce };
}

/** The saved nonce, if one exists and is still young. Does not consume it. */
function savedNonce(storage: NonceStorage, key: string, nowMs: number): string | null {
  let raw: string | null = null;
  try { raw = storage.getItem(key); } catch { return null; }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { n?: unknown; at?: unknown };
    if (typeof v?.n !== 'string' || !NONCE_RE.test(v.n)) return null;
    if (typeof v.at !== 'number' || nowMs - v.at > NONCE_MAX_AGE_MS || v.at > nowMs + 60_000) return null;
    return v.n;
  } catch {
    return null;
  }
}

function forget(storage: NonceStorage, key: string): void {
  try { storage.removeItem(key); } catch { /* nothing more to do */ }
}

/**
 * True only when `presented` equals the nonce this tab saved for an attempt it started — and in that
 * case the saved nonce is DELETED, so the same nonce can never accept a second token.
 *
 * A mismatch does not delete it: a planted link arriving while the user's own sign-in is in flight
 * must not be able to cancel that sign-in.
 */
export function consumeGithubNonce(
  storage: NonceStorage | null,
  key: string,
  presented: unknown,
  nowMs: number,
): boolean {
  if (!storage || typeof presented !== 'string' || !NONCE_RE.test(presented)) return false;
  const saved = savedNonce(storage, key, nowMs);
  if (!saved || saved !== presented) return false;
  forget(storage, key);
  return true;
}

/**
 * Take the device nonce for a ticket redemption. Single use: it is deleted whether or not the
 * redemption then succeeds, because a ticket is good for one attempt and a retry starts a new flow.
 */
export function takeDeviceNonce(storage: NonceStorage | null, nowMs: number): string | null {
  if (!storage) return null;
  const saved = savedNonce(storage, GITHUB_DEVICE_NONCE_KEY, nowMs);
  forget(storage, GITHUB_DEVICE_NONCE_KEY);
  return saved;
}

export type GithubFragmentIntake =
  /** No GitHub token in the fragment — nothing to do, leave the URL alone. */
  | { kind: 'absent' }
  /** The token belongs to an attempt this tab started. Store it; clear the fragment. */
  | { kind: 'accepted'; token: string }
  /** A token this tab did not ask for. Discard it; clear the fragment. */
  | { kind: 'rejected'; reason: 'no-nonce' | 'nonce-mismatch' | 'empty-token' };

/**
 * Decide what to do with the page's `#…` fragment on load. The ONLY way a fragment token reaches
 * storage on the web; App.tsx calls this and does exactly what it says.
 */
export function takeGithubReturnFragment(
  hash: string,
  storage: NonceStorage | null,
  nowMs: number,
): GithubFragmentIntake {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  if (!params.has('gh_token')) return { kind: 'absent' };
  const token = (params.get('gh_token') || '').trim();
  const nonce = params.get('gh_nonce');
  if (!nonce) return { kind: 'rejected', reason: 'no-nonce' };
  if (!consumeGithubNonce(storage, GITHUB_WEB_NONCE_KEY, nonce, nowMs)) {
    return { kind: 'rejected', reason: 'nonce-mismatch' };
  }
  if (!token) return { kind: 'rejected', reason: 'empty-token' };
  return { kind: 'accepted', token };
}

/** Web Storage, or null where the browser refuses access to it. Never throws. */
export function browserStorage(which: 'session' | 'local'): NonceStorage | null {
  try {
    return which === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}
