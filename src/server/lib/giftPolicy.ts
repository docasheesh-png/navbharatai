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
// ⚠️ WHY THIS IS A MODULE AND NOT THREE EDITS. Before today the payouts lived in FOUR places that
// did not know about each other — `welcomeBonus.ts` (the legacy flat ₹500), `giftPlan.ts` (the v2
// ₹250/₹500, through TWO separate decisions), `weeklyTopUp.ts` (₹200 a rung to a ₹650 lifetime cap)
// and `referralRewards.ts`. The rule that they must not stack existed only as a COMMENT inside the
// last one. A real account could therefore collect ₹650 of flat-and-weekly gifts AND ₹400 of referral
// steps — over ₹1,050, with nothing failing and no screen showing a wrong number.
//
// 🔒 AND A CEILING THAT IS ONLY ARITHMETIC IS NOT A CEILING. "4 steps × ₹100 = ₹400" holds until
// somebody sets `REFERRAL_STEP_TOKENS=200` in a console, at which point the same four steps pay ₹800
// and nothing objects. "Ek paisa jyada nahi" has to be enforced against the TOTAL, not assumed from
// the parts — so the cap below is applied to what an account has ALREADY been given, at the moment of
// granting, whatever the per-step value happens to be.

// 🔗 HOW THIS RELATES TO `welcomeGiftExclusion.ts`, so neither is deleted as a duplicate of the other.
// That module answers a CONDITIONAL question — "is the referral ladder paying instead?" — and is
// asked INSIDE `welcomeBonus.ts` and `giftPlan.ts`. This one answers an UNCONDITIONAL one: the admin
// retired the flat gift outright, so it is off whatever any env key says, and the stand-down is
// applied at `routes/wallet.ts`, the single place either plan moves money. Two nets, deliberately at
// different heights: if the flat gift is ever re-enabled here, that module still stops it stacking
// with the ladder.

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

/**
 * The most an account may EVER be gifted through the WEBSITE. ₹100 (admin 2026-09-26: *"website par
 * github aur mobile verification par 100-100 maximum 100 only"*).
 *
 * 🔒 WHY THE WEB HAS ITS OWN, SMALLER CEILING. The full ₹400 ladder is claimed inside the Android app
 * behind the Play Integrity device check, which bounds how many accounts can farm it at once. The web
 * has no such check — a linked GitHub account is free and scriptable — so the web is deliberately
 * capped at a single ₹100 grant per account. The strong web gate is the MOBILE step (a real SIM,
 * TRAI-bounded); GitHub on the web rides inside this same ₹100 so it can never become a second
 * scriptable ₹100. This is a SUB-ceiling: it sits under `MAX_SELF_GIFT_TOKENS`, never above it, so an
 * account that took ₹100 on the web can still earn the remaining ₹300 on a verified Android device.
 */
export const MAX_WEB_GIFT_TOKENS = 100 * TOKENS_PER_RUPEE;

/** What acquiring one user may cost NavBharatAI, all in. ₹475. Stated so the sum is checkable. */
export const MAX_ACQUISITION_COST_TOKENS = MAX_SELF_GIFT_TOKENS + MAX_REFERRER_PER_FRIEND_TOKENS;

/**
 * Is the flat WELCOME gift allowed? **No.** Retired by the ruling above.
 *
 * Kept as a named function rather than deleting `welcomeBonus.ts` and `giftPlan.ts` outright: those
 * modules also carry the identity markers and the ledger shapes that existing wallets were written
 * with, and an account mid-way through the old plan still has to read back correctly. What changes is
 * that they GRANT nothing from now on.
 */
export function flatWelcomeGiftAllowed(): boolean {
  return false;
}

/** Is the WEEKLY top-up ladder allowed? **No.** Same ruling. */
export function weeklyTopUpAllowed(): boolean {
  return false;
}

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
 * Clamp a WEB grant so an account's total WEBSITE-earned gift can never pass ₹100.
 *
 * `alreadyWebGifted` is the account's own running total of what it has been paid THROUGH THE WEB
 * (`webGiftedTokens`), written in the same transaction as every web credit — so, like `capSelfGift`,
 * this is a decision about the real figure, not a guess. A negative or unreadable total is treated as
 * 0: unreadable must never mean "unlimited room". Apply it AFTER `capSelfGift`, never instead of it —
 * the ₹400 lifetime ceiling still governs; this only makes the web's slice of it ₹100.
 */
export function capWebGift(grantTokens: number, alreadyWebGifted: unknown): number {
  const want = Number(grantTokens);
  if (!Number.isFinite(want) || want <= 0) return 0;
  const givenRaw = Number(alreadyWebGifted);
  const given = Number.isFinite(givenRaw) && givenRaw > 0 ? Math.floor(givenRaw) : 0;
  const room = MAX_WEB_GIFT_TOKENS - given;
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

/**
 * What the wallet screen should say about the flat gift once it is retired: nothing at all.
 *
 * 🔒 `capTokens: 0` IS THE POINT, not an oversight. `FreeGiftBanner` renders nothing when the cap is
 * not a positive number, so a retired programme disappears from the screen instead of describing
 * itself in zeroes ("₹0 of ₹500 free credit received — ₹500 still to come" is a promise, not a
 * status). Every other field is the truth about an account that can no longer be gifted: nothing is
 * coming, nothing is claimable, no date. `giftedTokens` still reports what the account really
 * received, because retiring a gift never rewrites the history of one already given.
 *
 * ⚠️ `phoneBonusClaimable` MUST stay 0. It is the single field that draws the "Claim ₹500" card, and
 * offering a claim that `/claim-phone-bonus` will refuse is exactly the confident-and-wrong status
 * this codebase forbids.
 */
export function retiredGiftSummary(alreadyGifted: unknown): Record<string, unknown> {
  const raw = Number(alreadyGifted);
  const gifted = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  return {
    plan: 'retired',
    giftedTokens: gifted,
    capTokens: 0,
    remainingTokens: 0,
    exhausted: true,
    nextCreditAt: null,
    phoneBonusClaimable: 0,
  };
}
