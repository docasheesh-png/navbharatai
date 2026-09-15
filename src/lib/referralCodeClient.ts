// The client's copy of the referral-code normaliser.
//
// A SEPARATE FILE rather than an import of `src/server/lib/referralCode.ts`, for the same reason
// `referralStepNames.ts` exists: the server module is a server module, and pulling one into the
// browser bundle to reuse six lines is how a bundle acquires a Node shim. What it does here is
// smaller anyway — it TIDIES what the user typed so the Apply button can be enabled or disabled
// sensibly, and the SERVER still decides whether the result is a real code.
//
// 🔒 `tests/referralCodeAgree.test.ts` asserts the two normalisers agree on the same inputs, so the
// client can never accept something the server refuses (a confusing dead-end) or refuse something
// the server would accept (a code the user cannot use).

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 6;

/** What the user typed, tidied into a code — or null if it cannot be one. */
export function normalizeReferralCodeClient(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toUpperCase().replace(/[\s\-_]/g, '');
  if (s.length !== LENGTH) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}
