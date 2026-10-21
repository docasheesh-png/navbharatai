// THE SIGN-IN CHECKBOX: "I am 18 or older, and I agree to the Terms of Service and Privacy Policy"
// (admin 2026-10-21).
//
// WHY THIS EXISTS. Both documents say "by creating an account you agree" and Terms Section 1 says "you must be
// 18 or older" — but the sign-in screen asked for neither, so the agreement rested on nothing the person had
// ever done. A document that binds people who were never shown it, and an age rule nobody was asked about, are
// the two weakest promises in the set.
//
// 🔑 ONE BOX, NOT TWO — and the reason is the admin's question answered. Agreeing to the Terms and being 18 are
// the same kind of statement: both are conditions of using the product at all, neither is optional, and a
// person cannot use NavBharatAI having ticked one and not the other. Two boxes would add a tap and a way to
// be half-ready, and would make a person decide twice about one thing. What stays SEPARATE is anything that
// really is optional — the Meta advertising measurement lives in the consent banner and is not bundled here.
// The age is part of the sentence, in plain words, so it is a statement the person actually read.
//
// 🔒 THE LINKS OPEN IN A NEW TAB (or the phone's own browser), never over the sign-in card: leaving the form to
// read the Terms and coming back to an empty box is how people give up. They are absolute https addresses
// because in the bundled phone app a relative `/terms` means `https://localhost/terms`.
//
// 🔒 WHAT IS RECORDED, AND WHY AFTER SIGN-IN. The sign-in itself happens in Firebase on the device, so the
// server cannot refuse it; what it CAN do is keep the evidence. When the person starts a sign-in with the box
// ticked, a small marker (the two document versions, the time) is held on the device; the moment an account is
// signed in, the app posts it to the server, which stores it on the profile and the marker is cleared. If the
// post fails the marker stays and is retried on the next launch — a record that is lost to a bad network once
// is not lost for ever. The versions are the documents' own "last updated" dates, so a later change of the
// documents can tell exactly who agreed to which text.
//
// PURE — storage is passed in, so the shapes are unit-testable without a browser.

export const TERMS_URL = 'https://navbharatai.com/terms';
export const PRIVACY_URL = 'https://navbharatai.com/privacy';

/** localStorage key for the not-yet-recorded acceptance. */
export const PENDING_ACCEPTANCE_KEY = 'nb_pending_terms_acceptance_v1';

/** What the person is told when they try to continue without the box. */
export const ACCEPTANCE_REFUSAL =
  'Please tick the box to confirm that you are 18 or older and agree to the Terms of Service and Privacy Policy.';

export interface PendingAcceptance {
  /** The Terms' "last updated" label at the moment of agreeing, e.g. "21 October 2026". */
  termsVersion: string;
  /** The Privacy Policy's "last updated" label at the moment of agreeing. */
  privacyVersion: string;
  /** The box states the age, so ticking it IS the confirmation. */
  ageConfirmed: true;
  /** Device time of the tick (ms). Informational: the server stamps its own time. */
  at: number;
}

export interface MiniStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A version label is a short date such as "21 October 2026". Anything else is not one. */
export function isVersionLabel(v: unknown): v is string {
  return typeof v === 'string' && /^\d{1,2} [A-Z][a-z]{2,8} \d{4}$/.test(v);
}

export function buildPendingAcceptance(termsVersion: string, privacyVersion: string, now: number): PendingAcceptance | null {
  if (!isVersionLabel(termsVersion) || !isVersionLabel(privacyVersion)) return null;
  return { termsVersion, privacyVersion, ageConfirmed: true, at: now };
}

/** Read a held marker back, shape-checked: a damaged or edited value is NO marker, never a half-record. */
export function parsePendingAcceptance(raw: string | null | undefined): PendingAcceptance | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isVersionLabel(o.termsVersion) || !isVersionLabel(o.privacyVersion)) return null;
  if (o.ageConfirmed !== true) return null;
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0;
  return { termsVersion: o.termsVersion, privacyVersion: o.privacyVersion, ageConfirmed: true, at };
}

export function holdAcceptance(storage: MiniStorage | null, p: PendingAcceptance | null): boolean {
  if (!storage || !p) return false;
  try { storage.setItem(PENDING_ACCEPTANCE_KEY, JSON.stringify(p)); return true; } catch { return false; }
}

export function heldAcceptance(storage: MiniStorage | null): PendingAcceptance | null {
  if (!storage) return null;
  try { return parsePendingAcceptance(storage.getItem(PENDING_ACCEPTANCE_KEY)); } catch { return null; }
}

export function clearHeldAcceptance(storage: MiniStorage | null): void {
  if (!storage) return;
  try { storage.removeItem(PENDING_ACCEPTANCE_KEY); } catch { /* nothing to clear */ }
}
