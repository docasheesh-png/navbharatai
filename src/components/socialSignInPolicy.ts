// Social sign-in (Google/GitHub) — the ONE decision for what a popup failure means.
//
// ROOT CAUSE it fixes (admin, 2026-07-06 — "Google login is not smooth"): the popup catch treated
// `auth/popup-closed-by-user` (the USER cancelled) and `auth/cancelled-popup-request` (a double-tap
// superseded the first popup) the same as `auth/popup-blocked` — and responded with
// `signInWithRedirect`, a FULL-PAGE navigation to Google. So closing the popup ("cancel") forced the
// user straight back into the Google login anyway, and a double-tap set off a popup + a page
// navigation at once. Cancel must mean CANCEL; only a genuinely BLOCKED popup warrants the redirect
// fallback. Pure + exported for unit testing.

export type PopupFailureAction =
  /** The browser refused to open the popup — fall back to the full-page redirect flow. */
  | 'redirect'
  /** The user cancelled (closed the popup) or a second tap superseded it — stop quietly, no error. */
  | 'cancel'
  /** A genuine failure — surface it honestly. */
  | 'error';

export function popupFailureAction(code: string | null | undefined): PopupFailureAction {
  if (code === 'auth/popup-blocked') return 'redirect';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'cancel';
  return 'error';
}

/** The minimal auth surface waitForSignedInUser needs — injected so the helper is unit-testable. */
export interface MinimalAuthLike {
  currentUser: unknown | null;
  onAuthStateChanged(cb: (user: unknown | null) => void): () => void;
}

/**
 * ROOT CAUSE fix (admin 2026-07-11 — "Google login 1st time me logout hi rahta hai, 2nd time
 * chalta hai"): `signInWithPopup` can reject with `auth/popup-closed-by-user` even though the
 * sign-in actually COMPLETED — a real firebase-js-sdk race: the popup's closed-poller fires while
 * the auth event is still being delivered through the authDomain iframe (slowest on the FIRST
 * attempt, when the iframe is cold), and delivery can also lag under COOP/storage partitioning.
 * Our cancel handling then stopped QUIETLY — user picked their Google account, everything
 * succeeded server-side, and the UI still said logged-out. The second attempt worked because the
 * iframe/storage was warm by then.
 *
 * The fix: a "cancel" is only final AFTER a short grace window in which we watch for the sign-in
 * actually landing (currentUser / onAuthStateChanged). Signed in ⇒ the popup "cancel" was the
 * race, not the user — treat as success. Still null after the window ⇒ a genuine user cancel,
 * stop quietly exactly as before. Pure over the injected auth; never throws; always unsubscribes.
 */
export function waitForSignedInUser(auth: MinimalAuthLike, graceMs = 2500): Promise<unknown | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (u: unknown | null): void => {
      if (settled) return;
      settled = true;
      try { unsubscribe(); } catch { /* already torn down */ }
      clearTimeout(timer);
      resolve(u);
    };
    const timer = setTimeout(() => finish(auth.currentUser ?? null), Math.max(0, graceMs));
    const unsubscribe = auth.onAuthStateChanged((u) => { if (u) finish(u); });
  });
}
