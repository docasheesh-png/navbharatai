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

/**
 * WHICH WEB FLOW A PROVIDER GETS: the popup, or a full-page redirect.
 *
 * ROOT CAUSE (admin 2026-08-19, reproduced on desktop Chrome AND iPhone Safari, with the popup's own
 * DevTools attached). Apple sign-in reached Apple, and Apple COMPLETED it — the popup's network log
 * showed Apple's `authorize` response carrying a real `grant_code` and `userId`. Yet the app stayed
 * logged out and reported "didn't complete". The credential was never the problem; DELIVERING it back
 * to the opener was. Apple returns via `response_mode=form_post` — a CROSS-SITE POST into the popup —
 * and after it the popup navigated to the app instead of handing the result to the window that opened
 * it. That relay is exactly what modern storage partitioning / ITP breaks, which is why it failed
 * identically in two unrelated browsers. `popup-closed-by-user` was the only signal the SDK could give,
 * so the UI honestly, and uselessly, said "cancelled".
 *
 * The redirect flow has no relay to break: the whole page goes to Apple and comes back, and
 * `getRedirectResult` at the app root finalizes it. It is already wired (App.tsx) and already used as
 * the popup-blocked fallback — and this app is the ideal case for it, because `authDomain` is our OWN
 * origin (navbharatai.com). That was not an accident: firebase.ts records that the custom authDomain
 * was adopted PRECISELY so `signInWithRedirect` returns SIGNED-IN rather than logged-out.
 *
 * Apple ONLY. Google and GitHub deliver through the popup correctly today, and a redirect there would
 * trade a working, faster flow for a full page reload — a regression bought with someone else's bug.
 */
export type WebSignInStrategy = 'popup' | 'redirect';

export function webSignInStrategy(providerId: string | null | undefined): WebSignInStrategy {
  return providerId === 'apple.com' ? 'redirect' : 'popup';
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

// ─── Apple's return URL, and why a closed popup is not always a cancel ────────────────────────────

/**
 * The return URL Apple must have registered for web sign-in to work.
 *
 * ADMIN REPORT 2026-08-16, with Apple's own error page attached:
 *
 *   https://appleid.apple.com/auth/authorize
 *     ?client_id=com.navbharatai.web
 *     &redirect_uri=https%3A%2F%2Fnavbharatai.com%2F__%2Fauth%2Fhandler
 *   → invalid_request — "Invalid web redirect url."
 *
 * 🔒 ROOT CAUSE, and it is CONFIGURATION, not code: `authDomain` was moved to our own domain
 * (navbharatai.com) to fix signInWithRedirect's storage partitioning. Firebase therefore sends Apple
 * `redirect_uri=https://navbharatai.com/__/auth/handler`. That change was mirrored into the GOOGLE
 * OAuth client — the config comment in src/config/firebase.ts lists exactly that — but Apple keeps its
 * OWN Return URLs list on its Service ID, and nobody added the new URL there. So Google works and
 * Apple does not, which is precisely the reported symptom.
 *
 * ⚠️ THE FIX IS IN APPLE'S DEVELOPER PORTAL AND CANNOT BE MADE FROM CODE. What code CAN stop doing is
 * pretending this is a user cancel — see appleSignInFailureMessage.
 */
export const APPLE_WEB_RETURN_URL = 'https://navbharatai.com/__/auth/handler';
export const APPLE_SERVICE_ID = 'com.navbharatai.web';

/**
 * What to tell someone whose Apple popup closed without signing them in.
 *
 * 🔒 WHY THIS IS NOT "Sign-in was cancelled": Firebase reports `auth/popup-closed-by-user` for BOTH a
 * real cancel AND a popup the user closed because Apple showed it an error — the two are
 * indistinguishable from the SDK. Today the Apple path treats every such close as a quiet cancel and
 * shows NOTHING AT ALL, so a user who hit the configuration error above clicks the button, watches an
 * Apple error page, closes it, and the app says nothing. Forever. That is the single worst version of
 * this bug: not that it fails, but that it fails silently and looks like a dead button.
 *
 * So the message covers both readings honestly — it tells a genuine canceller to try again, and it
 * tells everyone else the exact thing that is wrong and the exact fix. Naming the Service ID and the
 * URL matters: this is a two-minute change in Apple's portal, and a message that omits them turns it
 * into an afternoon of searching.
 *
 * Deliberately Apple-only. Google's and GitHub's configuration IS correct, so a closed popup there
 * genuinely is a cancel and must stay silent.
 */
export function appleSignInFailureMessage(): string {
  return 'Apple sign-in didn\'t complete. If you closed the window, just try again. '
    + 'If Apple showed an error page, this site\'s return URL isn\'t registered with Apple yet — '
    + `Admin: add ${APPLE_WEB_RETURN_URL} to the Return URLs of Service ID ${APPLE_SERVICE_ID} `
    + 'in the Apple Developer portal (Certificates, Identifiers & Profiles → Identifiers → Services IDs).';
}
