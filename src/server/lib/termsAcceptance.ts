// THE SERVER HALF OF THE SIGN-IN CHECKBOX: keep the evidence that a person agreed (admin 2026-10-21).
//
// The checkbox itself is on the sign-in screen (src/lib/signupAcceptance.ts has the whole design). Sign-in
// happens in Firebase on the person's device, so the server cannot refuse it — what it can do is store, against
// the signed-in account, WHICH versions of the Terms and Privacy Policy the person agreed to and WHEN, and that
// they confirmed they are 18 or older.
//
// 🔒 THE SERVER'S CLOCK IS THE RECORD. The device sends the versions it showed; the time stored is the server's.
//    A device clock cannot back-date an agreement.
// 🔒 IDEMPOTENT. Posting the same versions again changes nothing (the first time of agreeing is kept, and a
//    retry after a flaky network is harmless). A NEWER version replaces the current one and keeps the first.
// 🔒 THE WRITE IS REPORTED HONESTLY. `recordTermsAcceptance` returns true only after the document was really
//    written; the client clears its held marker only on that answer, so a lost write is retried, not forgotten.
// 🔒 ERASED WITH THE ACCOUNT. It lives on `user_profiles/{uid}`, which account deletion already erases.

import { doc, getDoc, setDoc } from './serverDb';
import { isVersionLabel } from '../../lib/signupAcceptance';

export interface TermsAcceptance {
  termsVersion: string;
  privacyVersion: string;
  /** The box states "18 or older"; ticking it is the confirmation. Always true when present. */
  ageConfirmed: true;
  /** ISO time of the most recent agreement (server clock). */
  acceptedAt: string;
  /** ISO time of the very first agreement (server clock). */
  firstAcceptedAt: string;
}

export type AcceptanceParse =
  | { ok: true; value: { termsVersion: string; privacyVersion: string } }
  | { ok: false; error: string };

/** Judge what the app sent. Only the two version labels and the age confirmation are accepted — nothing else is read. */
export function parseAcceptanceRequest(body: unknown): AcceptanceParse {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (b.ageConfirmed !== true) return { ok: false, error: 'The age confirmation is missing.' };
  if (!isVersionLabel(b.termsVersion)) return { ok: false, error: 'The Terms version is not valid.' };
  if (!isVersionLabel(b.privacyVersion)) return { ok: false, error: 'The Privacy Policy version is not valid.' };
  return { ok: true, value: { termsVersion: b.termsVersion, privacyVersion: b.privacyVersion } };
}

/** The record after this agreement. Pure. */
export function nextAcceptance(
  existing: Partial<TermsAcceptance> | null | undefined,
  req: { termsVersion: string; privacyVersion: string },
  nowIso: string,
): TermsAcceptance {
  const same = existing?.termsVersion === req.termsVersion && existing?.privacyVersion === req.privacyVersion
    && existing?.ageConfirmed === true && typeof existing?.acceptedAt === 'string';
  const first = typeof existing?.firstAcceptedAt === 'string' ? existing.firstAcceptedAt
    : typeof existing?.acceptedAt === 'string' ? existing.acceptedAt : nowIso;
  if (same) return { ...(existing as TermsAcceptance), firstAcceptedAt: first };
  return { termsVersion: req.termsVersion, privacyVersion: req.privacyVersion, ageConfirmed: true, acceptedAt: nowIso, firstAcceptedAt: first };
}

export const PROFILES_COLLECTION = 'user_profiles';

/** Store the agreement. true = it is now on the profile; false = it could not be written (the app will retry). */
export async function recordTermsAcceptance(
  db: any, uid: string, req: { termsVersion: string; privacyVersion: string }, nowIso: string = new Date().toISOString(),
): Promise<boolean> {
  if (!db || !uid) return false;
  try {
    const ref = doc(db, PROFILES_COLLECTION, uid);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? (snap.data() as { termsAcceptance?: Partial<TermsAcceptance> })?.termsAcceptance : null;
    const next = nextAcceptance(existing, req, nowIso);
    // A merge write: it must never touch the display name, the +18 setting or any other field on the profile.
    await setDoc(ref, { userId: uid, termsAcceptance: next, updatedAt: Date.now() }, { merge: true });
    return true;
  } catch {
    return false;
  }
}
