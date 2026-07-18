// nativeAuthGuard — kill the "infinite login spinner" CLASS (admin iPhone report 2026-07-17).
//
// The native sign-in bridge (Capacitor plugin) returns a promise that, on a wiring/SDK fault, can stay
// PENDING FOREVER (the real case: the Google redirect URL never reached GIDSignIn, so its completion
// callback never fired — the user stared at a spinner for good). The AppDelegate wiring fixes that root
// cause; THIS guard fixes the class: no native auth call may ever hang the UI. If the bridge gives no
// answer within the window, the user gets an honest, retryable error instead of an endless spinner.
// PURE — fully unit-testable.

/** How long a native sign-in may stay unanswered before we surface an honest timeout (ms).
 *  Generous on purpose: the user may be reading a consent screen or typing a password. */
export const NATIVE_AUTH_TIMEOUT_MS = 120_000;

/**
 * Race a native-bridge promise against an honest timeout. On timeout the returned promise REJECTS with
 * `timeoutMessage` (an Error), freeing the caller's spinner; a late native result is simply ignored
 * (the user retries — no half-completed state is committed, because the Firebase JS sign-in only ever
 * runs AFTER this resolves). The timer is cleared on settle so tests/processes never leak it.
 */
export function raceNativeAuth<T>(
  promise: Promise<T>,
  timeoutMessage: string,
  timeoutMs: number = NATIVE_AUTH_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Race a BEST-EFFORT promise against a timeout that RESOLVES (never rejects) — for pre-login cleanup
 * that must never block the sign-in. If `promise` doesn't settle within `timeoutMs`, we resolve anyway
 * and let the caller proceed; a late or failed `promise` is swallowed.
 *
 * ROOT-CAUSE of why this exists (admin 2026-07-18, TestFlight build 25): the pre-login "force-logout the
 * old session" step AWAITED an UNBOUNDED signOut. On the iOS WKWebView that signOut can hang, so the
 * sign-in never started and the user got an immediate, permanent spinner (Google never opened). Unlike
 * raceNativeAuth (which REJECTS on timeout to surface an honest error for the sign-in ITSELF), this NEVER
 * throws — a cleanup step that hangs must silently yield to the real login, not fail it. The timer is
 * cleared on settle so nothing leaks.
 */
export function settleWithinOrProceed(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const done = () => { clearTimeout(timer); resolve(); };
    promise.then(done, done);
  });
}

/**
 * May we sign the WEB-SDK auth instance out right BEFORE a new login? Only on the WEB.
 *
 * ROOT CAUSE this encodes (admin 2026-07-18, iOS TestFlight build 27): on the native WKWebView a web-SDK
 * signOut can hang on its persistence write, and a hung signOut HOLDS Firebase Auth's internal operation
 * queue — so the `signInWithCredential` that follows is stuck behind it and the login never completes
 * ("Google returned token: YES → verifying with Firebase… → sign-in did not complete"). The native sign-in
 * replaces the old session by itself, so a pre-login web signOut is both unnecessary AND harmful there.
 * On a real browser signOut is safe (normal IndexedDB) and clears a stale session that could wedge the
 * popup, so it's allowed. Pure so the invariant is locked by a test — never let a pre-login web signOut
 * back onto the native path.
 */
export function preLoginWebSignOutAllowed(isNativePlatform: boolean): boolean {
  return !isNativePlatform;
}
