// "This user just created their account" — decided in ONE place, for every sign-in path.
//
// WHY A MODULE AND NOT A trackEvent() CALL AT THE SIGN-UP BUTTON: NavBharatAI has eight distinct
// paths that end in a signed-in user (email create, email sign-in, phone OTP web, phone OTP native,
// Google popup, Google redirect, Google native, GitHub). Putting a signup event on each one is the
// duplicated-code-that-drifts pattern the fourth absolute rule exists to prevent — the ninth path
// added later would silently not report, and nothing would fail to reveal it.
//
// So the signal is derived at the ONE place every successful sign-in already passes through
// (onAuthStateChanged in App.tsx, which the account-roster code uses for exactly the same reason),
// from evidence Firebase gives us on every provider: an account whose creation time and last-sign-in
// time are the same moment has just been created.
//
// DEDUPED, because onAuthStateChanged also fires on every page load and token refresh, and Firebase
// keeps reporting the same creationTime forever. Without the guard a user who created an account
// today would re-report a registration on every reload for as long as the timestamps stayed close —
// inflating the conversion count that ad spend is optimised against, which is a measurement lie even
// though no user is harmed by it.

import { decideReportOnce, type ReportDecision } from './conversionOnce';

/** localStorage key holding the uids whose signup has already been reported. */
export const SIGNUP_REPORTED_KEY = 'navbharat_signup_reported';

/**
 * Pure: did this account come into existence at (essentially) this sign-in?
 *
 * Firebase reports both stamps as RFC-1123 strings. They are written by two different server-side
 * steps during account creation, so they are close but not always byte-identical — hence a
 * tolerance rather than an equality check. 15s is comfortably wider than that gap and far narrower
 * than any real returning-user interval.
 */
export function isNewAccount(
  creationTime: string | null | undefined,
  lastSignInTime: string | null | undefined,
  toleranceMs = 15_000,
): boolean {
  const created = Date.parse(String(creationTime ?? ''));
  const lastSignIn = Date.parse(String(lastSignInTime ?? ''));
  // Unparseable stamps mean we do not KNOW this is a new account. Reporting a registration on a
  // guess would corrupt the campaign signal, so the honest answer is "no".
  if (!Number.isFinite(created) || !Number.isFinite(lastSignIn)) return false;
  return Math.abs(lastSignIn - created) <= toleranceMs;
}

/** Pure: report this sign-in as a registration? Once per account, never on a reload. */
export function decideSignupReport(rawStored: string | null | undefined, uid: string, isNew: boolean): ReportDecision {
  return decideReportOnce(rawStored, uid, isNew);
}
