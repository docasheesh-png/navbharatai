// One phone-number normaliser, shared by the browser and the server.
//
// WHY SHARED (2026-08-22): the sign-in screen already normalised numbers its own way — 10 digits get
// `+91`, anything else must carry a country code — and the server was about to need the SAME rule to
// look a number up in the auth directory. Two copies of a rule like this drift, and when they drift
// the failure is silent and specific: the client sends `+919876543210`, the server looks up
// `9876543210`, finds nothing, and cheerfully lets a duplicate through. This repo has been bitten by
// drifted copies twice (four `safeRelPath`s, five hardcoded model ids), so this one starts shared.
//
// It lives in `src/lib` rather than `src/server/lib` for exactly that reason: the frontend cannot
// import server code, so anything both sides need has to sit here or it will be duplicated.
//
// PURE — no I/O, no formatting for display, no validation beyond "could this be dialled".

/** India, because that is who this product is for — and it is the client's existing rule, not a new one. */
export const DEFAULT_COUNTRY_CODE = '+91';

/**
 * A phone number in the E.164-ish form the auth provider stores, or null when the input cannot be one.
 *
 * Deliberately conservative: it strips the punctuation people type (spaces, dashes, brackets) and
 * applies the default country code ONLY to a bare 10-digit number. It never guesses a country for an
 * 8- or 12-digit string — a wrong guess would look up somebody else's number, and "somebody else's
 * number" is precisely what the gate above this exists to detect.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (plus) {
    // A country code plus a national number: 8 digits is the shortest real E.164 subscriber form,
    // 15 the maximum the standard allows.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `${DEFAULT_COUNTRY_CODE}${digits}`;
  // 11 or 12 digits without a `+` is usually a country code someone forgot the plus on — but "usually"
  // is not good enough for a lookup that decides whether an account already exists.
  return null;
}

/** The last 4 digits, for a message that identifies a number without printing it. Pure. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '';
  return `••••${digits.slice(-4)}`;
}
