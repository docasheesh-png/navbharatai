// WHAT NAVBHARATAI GIVES AWAY — the whole policy, in one place, as CODE.
//
// 🔴 THE ADMIN'S RULING (2026-09-17, verbatim): *"nahi welcome bonus ₹500 band karna hai! sirf refer
// aur verification wale ₹400 dene hai. matlab mera (admin) ek user ke liye maximum = ₹475. isse 1
// paisa jyada nahi."* and *"weekly reward, welcome reward yeh sab hatao."*
//
// SO THERE IS EXACTLY ONE WAY TO BE GIVEN MONEY: earn it by verifying. Nothing is handed over for
// merely arriving.
//
//   New user, own steps  — ₹100 × 4 (apply a code, email, mobile, GitHub)        = ₹400
//   Their referrer       — ₹25 × 3 (that friend's email, mobile, GitHub)         = ₹75
//   ─────────────────────────────────────────────────────────────────────────────────
//   TOTAL COST OF ACQUIRING ONE USER                                             = ₹475
//
// 🔴 AND NOW IT IS THE ONLY WAY (admin 2026-09-26: *"100*4 ko chor ke sab hata do"*). The retired
// grants — the legacy flat bonus, the ₹250/₹500 v2 plan and its phone claim, the weekly ladder, the
// ₹50 interim credit and the ₹250 backfill — were deleted from the code, not just switched off. A new
// wallet is created empty (`newWallet.ts`), and the referral ladder is the one thing that gifts.
//
// 🔒 AND A CEILING THAT IS ONLY ARITHMETIC IS NOT A CEILING. "4 steps × ₹100 = ₹400" holds until
// somebody sets `REFERRAL_STEP_TOKENS=200` in a console, at which point the same four steps pay ₹800
// and nothing objects. "Ek paisa jyada nahi" has to be enforced against the TOTAL, not assumed from
// the parts — so the cap below is applied to what an account has ALREADY been given, at the moment of
// granting, whatever the per-step value happens to be.

import { TOKENS_PER_RUPEE } from './payments';

/**
 * The most an ACCOUNT may ever be gifted for its own actions. ₹400 — the four verification steps.
 *
 * Deliberately NOT `4 × REFERRAL_STEP_TOKENS`: deriving it from the tunable would let the tunable
 * raise its own ceiling, which is the whole failure mode this constant exists to prevent.
 */
export const MAX_SELF_GIFT_TOKENS = 400 * TOKENS_PER_RUPEE;

/** The most a referrer may be paid for ONE friend. ₹75 — that friend's three verifications. */
export const MAX_REFERRER_PER_FRIEND_TOKENS = 75 * TOKENS_PER_RUPEE;

/** What acquiring one user may cost NavBharatAI, all in. ₹475. Stated so the sum is checkable. */
export const MAX_ACQUISITION_COST_TOKENS = MAX_SELF_GIFT_TOKENS + MAX_REFERRER_PER_FRIEND_TOKENS;

/**
 * Clamp a self-gift so an account's LIFETIME total can never pass ₹400.
 *
 * `alreadyGifted` is the account's own running total (`freeGiftedTokens`), which is written in the
 * same transaction as every credit — so this is a decision about the real figure, not a guess.
 * A negative or unreadable total is treated as 0: unreadable must never mean "unlimited room".
 */
export function capSelfGift(grantTokens: number, alreadyGifted: unknown): number {
  const want = Number(grantTokens);
  if (!Number.isFinite(want) || want <= 0) return 0;
  const givenRaw = Number(alreadyGifted);
  const given = Number.isFinite(givenRaw) && givenRaw > 0 ? Math.floor(givenRaw) : 0;
  const room = MAX_SELF_GIFT_TOKENS - given;
  if (room <= 0) return 0;
  return Math.min(Math.floor(want), room);
}

/**
 * Clamp what a referrer is paid for ONE friend, so no tunable can make a single friend worth more
 * than ₹75. The LIFETIME referrer cap (₹1,500 across all friends) is separate and still applies.
 */
export function capReferrerPerFriend(grantTokens: number, alreadyPaidForThisFriend: unknown): number {
  const want = Number(grantTokens);
  if (!Number.isFinite(want) || want <= 0) return 0;
  const paidRaw = Number(alreadyPaidForThisFriend);
  const paid = Number.isFinite(paidRaw) && paidRaw > 0 ? Math.floor(paidRaw) : 0;
  const room = MAX_REFERRER_PER_FRIEND_TOKENS - paid;
  if (room <= 0) return 0;
  return Math.min(Math.floor(want), room);
}
