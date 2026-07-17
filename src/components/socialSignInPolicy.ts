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
/**
 * ROOT-CAUSE FIX for the "stuck on the login spinner after returning from Google" hang (admin
 * 2026-07-17, iPhone): on iOS WKWebView the JS-SDK credential exchange (`signInWithCredential`) can
 * stall on its persistence write and never settle, so the spinner spun forever and the auth modal
 * never closed. This settles the native exchange WITHOUT ever hanging the UI:
 *   • the exchange settles OK within `timeoutMs`            → 'ok'
 *   • it overruns or rejects, but the sign-in actually LANDED (auth.currentUser now, or via the
 *     auth listener within `graceMs`)                       → 'ok'  (the exchange promise raced its
 *                                                                     own auth event — a real SDK race)
 *   • it overruns/rejects and no session ever appears       → 'failed' (caller surfaces an honest error)
 * Pure over the injected auth + the caller's exchange promise; never throws; always resolves in
 * bounded time. Unit-tested with fake promises + a fake auth.
 */
export async function settleNativeSignIn(
  exchange: Promise<unknown>,
  auth: MinimalAuthLike,
  timeoutMs = 15000,
  graceMs = 3000,
): Promise<'ok' | 'failed'> {
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('exchange-timeout')), Math.max(0, timeoutMs));
      exchange.then(
        () => { clearTimeout(timer); resolve(); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
    return 'ok';
  } catch {
    // Overran or failed — but the session may have landed anyway (the SDK race). Check now, then briefly.
    if (auth.currentUser) return 'ok';
    const landed = await waitForSignedInUser(auth, graceMs);
    return landed ? 'ok' : 'failed';
  }
}

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
