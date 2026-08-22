// WHO a free gift belongs to — the identity a welcome gift is bound to, rather than the ACCOUNT that
// happens to be asking for it (admin 2026-08-21).
//
// THE HOLE THIS CLOSES. The welcome gift is idempotent per `userId`, which stops a wallet-doc
// recreation from re-minting it — but a NEW account is a new uid, and accounts are free. So one
// person could take the gift again and again:
//   • `me+1@gmail.com`, `me+2@gmail.com`, `m.e@gmail.com` are ONE Gmail inbox and THREE Firebase
//     users. Cost to do it: nothing, ten seconds, no GitHub and no cleverness required.
//   • With v5 apps stored on GitHub, the work carries across those accounts while the cost resets —
//     which is what turns a small leak into a way to build an entire paid-size app for free.
//
// So the gift is keyed on a NORMALIZED identity: the mailbox a person actually owns, and (for the
// verified tier) the phone number they actually hold.
//
// ⚠️ WHAT THIS IS NOT. Normalizing does not stop someone registering a genuinely new address — that
// is what the phone tier is for. It closes the FREE, INSTANT version, which is the one that scales.

import { createHash } from 'crypto';

/** Gmail and its alias domain treat dots as insignificant. No other major provider does. */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * The canonical mailbox for gift purposes. Lowercased; `+suffix` removed; for Gmail only, dots
 * removed and `googlemail.com` folded to `gmail.com`.
 *
 * Plus-stripping is applied to EVERY domain on purpose: `a+b@x.com` is an alias of `a@x.com`
 * essentially everywhere it is accepted at all, and no major provider lets a second person register
 * `a+b@` as their own primary address — so it cannot take a gift away from a different real human.
 * Dot-stripping is Gmail-ONLY, because `a.b@` and `ab@` really are different mailboxes elsewhere.
 *
 * Anything that is not a single-@ address is returned trimmed+lowercased and otherwise untouched —
 * better to under-normalize an oddity than to collapse two real people onto one key.
 */
export function normalizeEmailForGift(email: string | null | undefined): string {
  const raw = String(email ?? '').trim().toLowerCase();
  if (!raw) return '';
  const at = raw.indexOf('@');
  if (at <= 0 || at !== raw.lastIndexOf('@') || at === raw.length - 1) return raw;

  let local = raw.slice(0, at);
  let domain = raw.slice(at + 1);

  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  // A local part that is ONLY a suffix ("+tag@gmail.com") would collapse to empty and put every such
  // address on one key — keep the original rather than inventing a shared identity.
  if (plus === 0) local = raw.slice(0, at);

  if (GMAIL_DOMAINS.has(domain)) {
    domain = 'gmail.com';
    const undotted = local.replace(/\./g, '');
    if (undotted) local = undotted;
  }
  return `${local}@${domain}`;
}

/**
 * The canonical phone for gift purposes: digits only, with India's national prefix resolved so the
 * same handset cannot present as two identities. `+91 98765-43210`, `09876543210` and `9876543210`
 * all land on `919876543210`.
 *
 * Only the 10-digit Indian case is expanded — guessing a country code for an arbitrary number would
 * merge two genuinely different people, which costs an honest user their gift. Everything else keeps
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

/**
 * A secret mixed into the hash so a leaked database does not hand out a list of users' phone numbers.
 *
 * This matters more than it looks: an Indian mobile is ten digits behind known prefixes, so a PLAIN
 * SHA-256 of one is reversible by brute force in seconds. The pepper is what makes the stored marker
 * meaningless on its own.
 *
 * ⚠️ Changing it does NOT re-grant anyone — `giftMarkerCandidates` deliberately also checks the
 * unpeppered id, so introducing, rotating or losing this value can never mint a second gift. That
 * property is why the pepper is safe to add to a system that already has markers written.
 */
function giftPepper(env: NodeJS.ProcessEnv = process.env): string {
  return (env.GIFT_ID_PEPPER || env.SECRET_ENCRYPTION_KEY || '').trim();
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 40);
}

export type GiftIdentityKind = 'email' | 'phone';

/**
 * Every document id this identity may already have been recorded under, newest scheme FIRST.
 *
 * A caller must check them ALL before granting and write only `[0]`. The list exists so the marker
 * survives a pepper being introduced or changed — without it, adding a pepper would silently make
 * every existing marker unfindable and re-gift the entire user base. Money code does not get to
 * assume its own config never changes.
 */
export function giftMarkerCandidates(kind: GiftIdentityKind, normalizedValue: string): string[] {
  if (!normalizedValue) return [];
  const pepper = giftPepper();
  const bare = `gift_${kind}_${sha(`${kind}:${normalizedValue}`)}`;
  if (!pepper) return [bare];
  return [`gift_${kind}_${sha(`${kind}:${normalizedValue}:${pepper}`)}`, bare];
}

/** Convenience: the id a NEW marker for this identity should be written under. '' when unusable. */
export function giftMarkerIdToWrite(kind: GiftIdentityKind, normalizedValue: string): string {
  return giftMarkerCandidates(kind, normalizedValue)[0] ?? '';
}
