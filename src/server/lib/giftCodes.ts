// A PROMO CODE SOMEBODY BOUGHT — the pure rules behind "purchase promo code".
//
// Admin, 2026-09-22: *"promocode credit ke andar ek option aur add karo — **purchage promo code**.
// yaha user promocode purchage kar ke apne family/friend ko gift kar sakta hai! rate wahi jo ham
// charge karte hai, plus 2% pletform fee"*, and the condition that shapes the whole design:
// *"yaha jo purchage honge promocode woh real ₹ se honge navbharatai dwara gift kiye gaye welcome
// bonus se nahi!"*
//
// ── THE ONE CONDITION IS SATISFIED BY CONSTRUCTION, NOT BY A CHECK ───────────────────────────────
// A gift code is minted ONLY by the payment fulfilment path, after Cashfree has confirmed the money.
// The buyer's WALLET IS NEVER READ AND NEVER DEBITED — there is no code path from a balance to a
// code, so "bought with the welcome bonus" is not a case that can arise and then be refused. That is
// the difference between a rule and a guard, and this repo's own history (`giftSpend.ts`, the money
// audit) is why it is worth being the former.
//
// ── 🔴 THE REDEEMED CREDIT IS 'paid', NOT 'gift', AND THAT IS THE SUBTLE ONE ─────────────────────
// `walletMirror.ts` makes every credit declare whose money it is. An env PROMO coupon is 'gift' —
// NavBharatAI handing something over. A PURCHASED code is not: a real person paid us real rupees
// for it, and the recipient is holding money that genuinely arrived. Marking it 'gift' would put it
// behind `checkPlanPayable` and tell somebody their friend's money cannot buy a hosting plan — which
// would be false, and would be us keeping the cash and withholding the product.
//
// ⚠️ It does NOT move `totalMoneySpent` or `lastRechargeAt` on the recipient, because THEY did not
// pay us. Those two fields answer "has this person ever paid?", and the honest answer is still no.
//
// ── 🔴 ONE CODE, ONE REDEMPTION, ON THE **CODE** ─────────────────────────────────────────────────
// The existing marketing-coupon claim is `coupon_<CODE>_<uid>` — deliberately one per USER per code,
// which is right for a code printed on a poster. It is WRONG here: ten friends could each redeem the
// same ₹500 gift once. A purchased code is a bearer instrument, so the claim lives on the code
// document itself and a second redeemer finds it already spent.
//
// PURE — no Firestore, no clock, no env. The caller supplies randomness, the day's totals and the
// rate; the I/O half lives in the payment route.

import { giftPriceAtPct, type GiftPrice } from '../../lib/platformFee';

/** Firestore collection holding one document per minted code. Doc id IS the code. */
export const GIFT_CODE_COLLECTION = 'gift_codes';

/** The smallest and largest gift. The ceiling is `MAX_COUPON_VALUE_INR`, deliberately the same. */
export const MIN_GIFT_INR = 100;
export const MAX_GIFT_INR = 5_000;

/**
 * What ONE buyer may spend on gift codes in a day.
 *
 * 🔒 THIS IS CHARGEBACK EXPOSURE, NOT ABUSE THEORY. A code redeemed and spent cannot be un-spent, so
 * a payment reversed afterwards is money we simply lose. The cap bounds the size of that loss per
 * buyer per day; it is not a limit anybody buying a gift for a friend will ever meet.
 */
export const MAX_GIFT_CODES_PER_DAY = 5;
export const MAX_GIFT_INR_PER_DAY = 5_000;

/**
 * The code alphabet — no `0/O`, no `1/I/L`.
 *
 * A gift code is READ ALOUD, written on paper and typed by somebody who did not generate it. Every
 * ambiguous glyph is a support ticket, and the character set costs nothing to choose well.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const GIFT_CODE_PREFIX = 'NBGIFT-';
/** 10 characters from a 31-letter alphabet ≈ 2^49 — a code must not be guessable, it is money. */
const BODY_LENGTH = 10;

/**
 * Mint a code from caller-supplied randomness.
 *
 * ⚠️ THE RANDOMNESS IS A PARAMETER SO IT CANNOT QUIETLY BECOME `Math.random()`. The caller passes
 * `crypto.randomBytes`; a test passes a fixed buffer. A guessable gift code is a wallet anybody can
 * drain, which is exactly the class the coupon audit found in `FREE100` / `WELCOME100`.
 *
 * The modulo bias across a 31-letter alphabet on a 256-value byte is ~0.5% — irrelevant against 2^49
 * of search space, and rejection sampling here would only add a branch nothing can test.
 */
export function mintGiftCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(BODY_LENGTH);
  let body = '';
  for (let i = 0; i < BODY_LENGTH; i++) body += ALPHABET[bytes[i] % ALPHABET.length];
  return GIFT_CODE_PREFIX + body;
}

/** Codes are matched case- and space-insensitively — a phone keyboard will not match our casing. */
export function normalizeGiftCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/** Is this string shaped like a code WE minted? Cheap, and keeps a lookup off every stray word. */
export function isGiftCode(raw: unknown): boolean {
  const code = normalizeGiftCode(raw);
  if (!code.startsWith(GIFT_CODE_PREFIX)) return false;
  const body = code.slice(GIFT_CODE_PREFIX.length);
  if (body.length !== BODY_LENGTH) return false;
  for (const ch of body) if (!ALPHABET.includes(ch)) return false;
  return true;
}

/** Why a purchase was refused. Every branch names the number, so the user is never told just "no". */
export type GiftRefusalReason =
  | 'amount-invalid'
  | 'amount-too-small'
  | 'amount-too-large'
  | 'daily-count'
  | 'daily-amount';

export interface GiftPurchaseDecision {
  ok: boolean;
  reason?: GiftRefusalReason;
  message?: string;
  price?: GiftPrice;
}

/**
 * May this buyer buy a code of this size right now, and what does it cost?
 *
 * ⚠️ A WHOLE NUMBER OF RUPEES ONLY. A gift of ₹499.997 is not a thing anybody means, and a fractional
 * face value would make the recipient's credit disagree with the code's own printed worth once it is
 * rounded somewhere downstream. Refusing it is one line; chasing the paisa afterwards is not.
 *
 * `todayCount` / `todayInr` are what this buyer has ALREADY bought today — supplied by the caller,
 * so this stays pure and the window stays the server's to define.
 */
export function decideGiftPurchase(input: {
  faceInr: unknown;
  feePct: number;
  todayCount: number;
  todayInr: number;
}): GiftPurchaseDecision {
  const face = Number(input.faceInr);
  if (!Number.isFinite(face) || face <= 0 || !Number.isInteger(face)) {
    return { ok: false, reason: 'amount-invalid', message: 'Enter a whole rupee amount for the gift.' };
  }
  if (face < MIN_GIFT_INR) {
    return { ok: false, reason: 'amount-too-small', message: `The smallest gift code is ₹${MIN_GIFT_INR}.` };
  }
  if (face > MAX_GIFT_INR) {
    return { ok: false, reason: 'amount-too-large', message: `The largest gift code is ₹${MAX_GIFT_INR.toLocaleString('en-IN')}.` };
  }
  const count = Number(input.todayCount);
  const spent = Number(input.todayInr);
  // An unreadable tally counts as the worst case, never as zero — the cap exists for the case where
  // something has gone wrong, so it must not be opened BY something going wrong.
  const usedCount = Number.isFinite(count) ? count : MAX_GIFT_CODES_PER_DAY;
  const usedInr = Number.isFinite(spent) ? spent : MAX_GIFT_INR_PER_DAY;
  if (usedCount >= MAX_GIFT_CODES_PER_DAY) {
    return { ok: false, reason: 'daily-count', message: `You can buy ${MAX_GIFT_CODES_PER_DAY} gift codes a day. Please try again tomorrow.` };
  }
  if (usedInr + face > MAX_GIFT_INR_PER_DAY) {
    return { ok: false, reason: 'daily-amount', message: `Gift codes are limited to ₹${MAX_GIFT_INR_PER_DAY.toLocaleString('en-IN')} a day. Please try again tomorrow.` };
  }
  return { ok: true, price: giftPriceAtPct(face, input.feePct) };
}

/** The stored shape. `status` is the claim: a code leaves `unused` exactly once. */
export interface GiftCodeRecord {
  code: string;
  buyerUid: string;
  faceInr: number;
  paidInr: number;
  feeInr: number;
  orderId: string;
  status: 'unused' | 'redeemed';
  createdAt: string;
  redeemedBy?: string;
  redeemedAt?: string;
  note?: string;
}

/** What the redeemer's request is allowed to do to a record. Pure, so the route cannot improvise. */
export type GiftRedeemOutcome =
  | { ok: true; faceInr: number }
  | { ok: false; reason: 'not-found' | 'already-redeemed' | 'own-code'; message: string };

/**
 * Decide a redemption from the stored record.
 *
 * 🔒 A BUYER MAY NOT REDEEM THEIR OWN CODE. Not because it would cost us anything — the money is the
 * same either way — but because it would be a way to pay a 2% fee to move money from a wallet into
 * the same wallet, and anything that looks like a laundering step in a payments product is a feature
 * we should not offer. "Add credit" already does the useful half, without the fee.
 */
export function decideGiftRedemption(
  record: GiftCodeRecord | null | undefined,
  redeemerUid: string,
): GiftRedeemOutcome {
  if (!record) {
    return { ok: false, reason: 'not-found', message: 'That code is not valid. Please check it and try again.' };
  }
  if (record.status !== 'unused') {
    return { ok: false, reason: 'already-redeemed', message: 'This gift code has already been used.' };
  }
  if (record.buyerUid && record.buyerUid === redeemerUid) {
    return { ok: false, reason: 'own-code', message: 'This is a code you bought — share it with someone, or add credit to your own wallet instead.' };
  }
  const face = Number(record.faceInr);
  if (!Number.isFinite(face) || face <= 0) {
    return { ok: false, reason: 'not-found', message: 'That code is not valid. Please check it and try again.' };
  }
  return { ok: true, faceInr: face };
}
