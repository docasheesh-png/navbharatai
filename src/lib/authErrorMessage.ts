// What a person sees when sign-in fails — and only that.
//
// 🔴 WHY THIS EXISTS (admin 2026-09-26: "error ko generic karo … abhi andar ki coding show ho rahi"):
// the email sign-in screen printed the raw SDK error to the user, e.g.
//
//     [auth/invalid-credential] Firebase: Error (auth/invalid-credential).
//
// and, for an unrecognised failure, a second probe's raw server reply plus a paragraph naming our auth
// vendor, its console and the project id. Three problems in one line: it tells an attacker which auth
// backend and project we run, it breaks the White-Label law (a vendor name on a user screen), and it
// tells the person nothing they can act on.
//
// 🔒 THE RULES, all enforced by `tests/signInErrorsAreGeneric.test.ts`:
//   1. ONE message for every wrong-credential shape. "Wrong password" and "no such account" are the
//      SAME sentence, so the screen can never be used to find out which emails have an account (user
//      enumeration). This is deliberate, and it is why the admin's idea of separate "incorrect
//      password" / "incorrect email" messages is NOT what ships.
//   2. No error code, vendor name, project id, URL or raw server text ever reaches the return value.
//   3. Every configuration fault (a domain not authorised, a provider switched off, a bad key) reads
//      as "not available right now" — the person cannot fix it, and the detail belongs in the console,
//      where `logAuthErrorDetail` puts it.
// PURE — the component decides nothing about wording.

export type AuthErrorContext = 'sign-in' | 'sign-up' | 'reset' | 'otp' | 'social';

export const WRONG_CREDENTIALS = 'Email or password is incorrect.';
export const TOO_MANY_ATTEMPTS = 'Too many attempts. Please wait a few minutes and try again.';
export const SIGN_IN_UNAVAILABLE = 'Sign-in is not available right now. Please try again in a little while.';
export const NETWORK_ERROR = 'Could not connect. Check your internet connection and try again.';

/** The error code off anything a sign-in call may throw. Never throws itself. */
export function authErrorCode(err: unknown): string {
  try {
    const code = (err as { code?: unknown })?.code;
    if (typeof code === 'string' && code.trim()) return code.trim().toLowerCase();
    const msg = String((err as { message?: unknown })?.message ?? '');
    const m = /\bauth\/[a-z-]+/i.exec(msg);
    return m ? m[0].toLowerCase() : '';
  } catch {
    return '';
  }
}

const GENERIC_BY_CONTEXT: Record<AuthErrorContext, string> = {
  'sign-in': 'Sign-in failed. Please try again.',
  'sign-up': 'Could not create your account. Please try again.',
  reset: 'Could not send the reset email. Please try again.',
  otp: 'Could not verify your phone number. Please try again, or use Email or Google sign-in.',
  social: 'Sign-in failed. Please try again.',
};

/** The one sentence a person sees for a failed sign-in. PURE. */
export function userFacingAuthError(err: unknown, context: AuthErrorContext = 'sign-in'): string {
  const code = authErrorCode(err);
  switch (code) {
    // Rule 1 — every wrong-credential shape is ONE sentence.
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return WRONG_CREDENTIALS;
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return 'Please enter a valid email address.';
    case 'auth/missing-password':
      return 'Please enter your password.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'Please choose a stronger password — a longer one with letters and numbers.';
    case 'auth/email-already-in-use':
      // Sign-up has to say this or the person is stuck; it is the same answer every major product gives.
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    case 'auth/too-many-requests':
      return TOO_MANY_ATTEMPTS;
    case 'auth/network-request-failed':
    case 'auth/timeout':
      return NETWORK_ERROR;
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return 'Sign-in was cancelled. Please try again.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method. Sign in with that method first.';
    case 'auth/invalid-phone-number':
    case 'auth/missing-phone-number':
      return 'Please enter a valid mobile number with the country code (e.g. +91…).';
    case 'auth/invalid-verification-code':
    case 'auth/missing-verification-code':
      return 'That code is not correct. Please check it and try again.';
    case 'auth/code-expired':
      return 'That code has expired. Please request a new one.';
    case 'auth/quota-exceeded':
      return 'Too many codes have been sent. Please wait a while, or use Email or Google sign-in.';
    // Rule 3 — configuration faults: the person cannot fix them.
    case 'auth/unauthorized-domain':
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
    case 'auth/configuration-not-found':
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
    case 'auth/app-not-authorized':
    case 'auth/internal-error':
      return SIGN_IN_UNAVAILABLE;
    default:
      return GENERIC_BY_CONTEXT[context];
  }
}

/**
 * The full raw detail, for the developer console only — never for the screen. Kept so a real
 * configuration fault is still diagnosable from a desktop console after the screen went quiet.
 */
export function logAuthErrorDetail(context: AuthErrorContext, err: unknown, extra?: string): void {
  try {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[auth:${context}] ${authErrorCode(err) || 'no-code'} — ${detail}${extra ? ` — ${extra}` : ''}`);
  } catch { /* logging must never affect sign-in */ }
}
