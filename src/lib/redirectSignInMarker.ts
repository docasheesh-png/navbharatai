// DID A REDIRECT SIGN-IN COME BACK EMPTY? — the state that had no way to be seen.
//
// 🔒 WHY (admin, 2026-08-22): "Apple login — Apple par login successfully ho jata hai, wapas
// NavBharatAI par aao to phir bhi logged out. Bar bar. Yeh theek karoge?"
//
// The loop was silent BY CONSTRUCTION, and that is what made it unfixable from the outside. On return,
// `getRedirectResult` resolves with `null` and the SDK reports `auth/no-auth-event` — which is also
// exactly what a completely ordinary page load reports, on every visit, when no sign-in was pending.
// So the app could not tell "the user just came back from Apple with nothing" apart from "somebody
// opened the homepage", and it correctly stayed silent about both. The user saw a logged-out screen
// and no reason, forever.
//
// One marker separates them: we know we sent them to a provider, because we wrote it down first.
//
// It also buys a real RESCUE. If the session actually landed (auth.currentUser is set) while
// `getRedirectResult` returned null — a genuine SDK race this codebase has already hit twice on the
// popup path — the honest answer is "you are signed in", not an error. Checking is one property read.
//
// PURE over an injected storage, so every branch is unit-tested, including the ones that only happen
// on somebody else's phone.

/** Where the marker lives. `sessionStorage` in the browser — injected here so tests need no DOM. */
export interface MarkerStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RedirectMarker {
  /** Firebase provider id, e.g. 'apple.com'. */
  provider: string;
  /** When we navigated away (ms). */
  at: number;
}

const KEY = 'nbai:redirect-signin';

/**
 * How long a marker can still describe a real return.
 *
 * A sign-in that left an hour ago is not a return, it is litter — and reporting litter as a failure
 * would put an error in front of someone who never tried to sign in. Ten minutes is comfortably longer
 * than any real provider round trip and far shorter than a browsing session.
 */
export const MARKER_TTL_MS = 10 * 60 * 1000;

/** Record that we are about to hand the whole page to a provider. Never throws. */
export function markRedirectStarted(store: MarkerStore | null | undefined, provider: string, now: number): void {
  try { store?.setItem(KEY, JSON.stringify({ provider: String(provider || ''), at: now })); } catch { /* private mode — we simply lose the ability to explain a failure */ }
}

/** Read the marker back, or null when absent/expired/corrupt. Never throws. PURE given the store. */
export function readRedirectMarker(store: MarkerStore | null | undefined, now: number): RedirectMarker | null {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RedirectMarker>;
    const at = typeof parsed?.at === 'number' ? parsed.at : 0;
    if (!at || now - at > MARKER_TTL_MS || now < at) return null;   // expired, or a clock that moved
    return { provider: String(parsed.provider || ''), at };
  } catch {
    return null;
  }
}

/** Forget the marker — always called once a return has been judged, so it can never fire twice. */
export function clearRedirectMarker(store: MarkerStore | null | undefined): void {
  try { store?.removeItem(KEY); } catch { /* nothing we can do, and nothing depends on it */ }
}

export type RedirectReturnVerdict =
  /** The redirect delivered a user — the normal, working path. */
  | 'signed-in'
  /** `getRedirectResult` gave nothing, but a session is present anyway — an SDK race, not a failure. */
  | 'recovered'
  /** We sent them to a provider and they came back with no session. THE reported bug. */
  | 'lost'
  /** No sign-in was pending. An ordinary page load — say nothing. */
  | 'none';

/**
 * Judge a return. PURE.
 *
 * Order matters: a delivered user is success whatever else is true; a present session outranks a null
 * result (the rescue); and only with a live marker AND no session anywhere is this the reported
 * failure. Without the marker the answer is always `none`, because being unable to prove a sign-in was
 * pending is not evidence that one failed — inventing an error there would put a red banner in front
 * of every visitor whose browser blocks session storage.
 */
export function redirectReturnVerdict(input: {
  marker: RedirectMarker | null;
  resultUser: unknown | null;
  currentUser: unknown | null;
}): RedirectReturnVerdict {
  if (input.resultUser) return 'signed-in';
  if (!input.marker) return 'none';
  if (input.currentUser) return 'recovered';
  return 'lost';
}

/**
 * What to say when a redirect sign-in comes back empty.
 *
 * It names the provider, states plainly that the provider's side worked (which is what the user just
 * watched happen, and disagreeing with them destroys trust in the message), and gives the two things
 * that actually resolve the common browser-side causes. It does NOT invent a cause it cannot prove.
 */
export function redirectLostMessage(provider: string | null | undefined): string {
  const name = providerLabel(provider);
  return `${name} accepted your sign-in, but this browser did not keep it when you came back. `
    + 'This is usually blocked cookies or private browsing — try again in a normal window with site data allowed. '
    + 'If it keeps happening, tell us and we will look at it from our side.';
}

/** A human name for a Firebase provider id. Unknown ids fall back to a neutral word, never a raw id. */
export function providerLabel(provider: string | null | undefined): string {
  switch (String(provider || '').toLowerCase()) {
    case 'apple.com': return 'Apple';
    case 'google.com': return 'Google';
    case 'github.com': return 'GitHub';
    default: return 'The sign-in provider';
  }
}
