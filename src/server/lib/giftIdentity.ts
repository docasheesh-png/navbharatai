// ONE PHONE NUMBER, ONE KEY — the canonical form of an Indian mobile number.
//
// This module used to bind the welcome gift to a PERSON (a normalized mailbox and phone, stored as
// peppered marker ids), so ten Gmail aliases could not collect ten gifts. The welcome gift is gone
// (admin 2026-09-26: "100*4 ko chor ke sab hata do" — the referral ladder is the only welcome credit),
// and with it the markers and the email normalizer. The phone normalizer stays because the OTP send
// limits (`routes/auth.ts`) key on it: without it, `+91 98765-43210` and `09876543210` would each get
// their own limit for one handset.
//
// The name keeps its `ForGift` suffix so the OTP route and its test did not have to change with it.

/**
 * The canonical phone number: digits only, with India's national prefix resolved so the
 * same handset cannot present as two identities. `+91 98765-43210`, `09876543210` and `9876543210`
 * all land on `919876543210`.
 *
 * Only the 10-digit Indian case is expanded — guessing a country code for an arbitrary number would
 * merge two genuinely different people onto one OTP limit. Everything else keeps
 * whatever country code it arrived with.
 */
export function normalizePhoneForGift(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;               // bare Indian mobile
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`; // 0-prefixed
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
}
