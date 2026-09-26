// ADMIN PROMO CODES — the codes the admin makes in Admin → Settings → Promo Code Generator.
//
// 🔴 WHY THIS MODULE EXISTS (admin 2026-09-26, asking only for a Delete button). The generator had
// written codes into `promo_codes` for months, and NOTHING READ THEM. The user's Promocode box
// (`/api/payment/redeem-coupon`) only ever consulted the purchased gift codes and the PROMO_COUPONS
// env table, so a code the admin made — the one on the admin's own screen was worth 1,000 tokens — was
// answered "Invalid or expired" for every user who typed it. Its "Used 0/1" was never going to move, and
// its "Discount %" had no reader anywhere in the product. Adding a Delete button to that would have
// been a working button on a feature that did nothing, so the admin chose to make the codes real.
//
// WHAT A CODE IS NOW:
//   • FREE TOKENS, in the wallet's own unit (admin's choice: 1,000 tokens = ₹10, the ₹1 = 100 tokens
//     rate every other credit uses). It is credited as GIFT money, exactly like a marketing coupon.
//   • MAX USES is a real total cap, counted in the same transaction as the credit, so two people
//     racing for the last use cannot both get it.
//   • ONE REDEMPTION PER USER, on the same claim id the env coupons use (`coupon_<CODE>_<uid>`), so a
//     code that exists in both places can never be redeemed twice by one person.
//   • DELETE removes the code; the users who already redeemed it keep their credit and their ledger.
//   • DISCOUNT % IS GONE. Nothing in the product ever applied it, and a field that looks like it does
//     something is the half-built state this repo's second absolute rule forbids.
//
// PURE. The Firestore half lives in `adminPromoStore.ts`.

import { MAX_COUPON_VALUE_INR } from './promoCoupons';
import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';

/** The most one code may ever be worth — the same ₹5,000 ceiling the env coupons carry, in tokens. */
export const ADMIN_PROMO_MAX_TOKENS = MAX_COUPON_VALUE_INR * TOKENS_PER_RUPEE;

/** A generous ceiling on "Max uses", so a slipped extra zero cannot mint an unbounded campaign. */
export const ADMIN_PROMO_MAX_USES = 100_000;

/**
 * Letters, digits and `@ . _ -`, 3–64 characters. `@` and `.` are allowed because the admin already
 * made a code out of an email address, and refusing the shape they naturally reach for would be a
 * support ticket for nothing. `/` is excluded because the code is also the Firestore document id.
 */
const CODE_SHAPE = /^[A-Z0-9@._-]{3,64}$/;

/** Upper-case and trim a typed code; null when it cannot be a code at all. */
export function normalizeAdminPromoCode(raw: unknown): string | null {
  const code = String(raw ?? '').trim().toUpperCase();
  return CODE_SHAPE.test(code) ? code : null;
}

export interface AdminPromoInput {
  code: string;
  freeTokens: number;
  maxUses: number;
}

export type ParseResult =
  | { ok: true; value: AdminPromoInput }
  | { ok: false; error: string };

/**
 * Validate what the admin typed. Every refusal names the field, because the admin types these by hand
 * and "invalid input" would leave them guessing. A malformed money value is REFUSED, never rounded
 * into some number nobody chose — the same law `promoCoupons.ts` applies to the env table.
 */
export function parseAdminPromoInput(body: unknown): ParseResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!String(b.code ?? '').trim()) return { ok: false, error: 'Promo code required.' };
  const code = normalizeAdminPromoCode(b.code);
  if (!code) {
    return { ok: false, error: 'Code must be 3–64 characters: letters, digits, and @ . _ - only.' };
  }
  const freeTokens = Number(b.freeTokens);
  if (!Number.isInteger(freeTokens) || freeTokens <= 0) {
    return { ok: false, error: 'Free tokens must be a whole number above 0 (100 tokens = ₹1).' };
  }
  if (freeTokens > ADMIN_PROMO_MAX_TOKENS) {
    return { ok: false, error: `Free tokens cannot be more than ${ADMIN_PROMO_MAX_TOKENS.toLocaleString('en-IN')} (₹${MAX_COUPON_VALUE_INR.toLocaleString('en-IN')}).` };
  }
  const rawUses = b.maxUses === undefined || b.maxUses === null || b.maxUses === '' ? 1 : Number(b.maxUses);
  if (!Number.isInteger(rawUses) || rawUses < 1 || rawUses > ADMIN_PROMO_MAX_USES) {
    return { ok: false, error: `Max uses must be a whole number from 1 to ${ADMIN_PROMO_MAX_USES.toLocaleString('en-IN')}.` };
  }
  return { ok: true, value: { code, freeTokens, maxUses: rawUses } };
}

/** The stored shape, as read back. Older records may also carry a `discountPct`, which is ignored. */
export interface AdminPromoRecord {
  code?: unknown;
  freeTokens?: unknown;
  maxUses?: unknown;
  usedCount?: unknown;
  active?: unknown;
  expiresAt?: unknown;
}

export type RedeemVerdict =
  | { ok: true; tokens: number }
  | { ok: false; reason: 'inactive' | 'expired' | 'used-up' | 'no-value' };

const toInt = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
};

/**
 * May this code be redeemed right now, and for how many tokens?
 *
 * Reads the record defensively, because some codes were written before this module existed: a missing
 * `maxUses` means 1 (what the old form defaulted to), a missing `usedCount` means 0, and a record worth
 * nothing — or worth more than the ceiling, which only hand-edited data could be — is refused rather
 * than credited.
 */
export function decideAdminPromoRedemption(rec: AdminPromoRecord, nowMs: number): RedeemVerdict {
  if (rec.active === false) return { ok: false, reason: 'inactive' };
  if (rec.expiresAt) {
    const t = Date.parse(String(rec.expiresAt));
    if (Number.isFinite(t) && t <= nowMs) return { ok: false, reason: 'expired' };
  }
  const tokens = toInt(rec.freeTokens, 0);
  if (tokens <= 0 || tokens > ADMIN_PROMO_MAX_TOKENS) return { ok: false, reason: 'no-value' };
  const maxUses = Math.max(1, toInt(rec.maxUses, 1));
  const used = Math.max(0, toInt(rec.usedCount, 0));
  if (used >= maxUses) return { ok: false, reason: 'used-up' };
  return { ok: true, tokens };
}

/** The status the admin's table shows — derived from the same rule the redemption uses. */
export function adminPromoStatus(rec: AdminPromoRecord, nowMs: number): 'Active' | 'Used up' | 'Expired' | 'Inactive' | 'No value' {
  const v = decideAdminPromoRedemption(rec, nowMs);
  if (v.ok) return 'Active';
  return v.reason === 'used-up' ? 'Used up'
    : v.reason === 'expired' ? 'Expired'
    : v.reason === 'no-value' ? 'No value'
    : 'Inactive';
}

/** What the user is told when a code exists but cannot be redeemed. Never names a reason we invented. */
export function adminPromoRefusal(reason: 'inactive' | 'expired' | 'used-up' | 'no-value'): string {
  return reason === 'used-up'
    ? 'This promo code has already been used the maximum number of times.'
    : 'Invalid or expired promoter voucher card.';
}
