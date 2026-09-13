// THE WELCOME GIFT BUYS BUILDS, NOT PLANS (admin-mandated 2026-09-13: "gift (free welcome gift from
// navbharatai) plan purchase me kam nahi ayenge!!!!!").
//
// ── WHY A MODULE AND NOT AN `if` AT THE PURCHASE ─────────────────────────────────────────────────
// The wallet holds ONE balance (THE ONE-WALLET LAW) and the user sees one number. What this adds is
// not a second wallet — it is a fact ABOUT that one balance: how much of it we gave away. A ₹500
// welcome gift is there so somebody can build something before they trust us with money. It is a
// sample, and a sample that buys a 30-day hosting plan is not a sample, it is the product for free.
//
// That fact has to be maintained by every writer that moves the balance, which is exactly the shape
// of bug `walletMirror.ts` was written to end: a rule applied at one call site and not its sibling.
// So the rule lives here, once, and the writers call it.
//
// ── THE MODEL, IN ONE LINE ───────────────────────────────────────────────────────────────────────
// `giftTokensRemaining` = how much of the CURRENT balance we gave away and the user has not spent.
//
//   • a GIFT credit (welcome, weekly top-up, coupon, admin grant)  → gift goes UP
//   • a REAL-MONEY credit (Cashfree, Play, Apple)                  → gift unchanged
//   • ordinary spending (builds, chat, hosting traffic)            → gift goes DOWN FIRST
//   • a PLAN purchase                                              → gift unchanged; only paid money moves
//
// 🔒 GIFT IS SPENT FIRST, AND THAT IS FOR THE USER, NOT AGAINST THEM. If paid money went first, a
// user who topped up ₹100 on top of a ₹500 gift would burn their own money while the gift sat there
// and, worse, could then be refused a plan they could actually afford. Spending the gift first means
// the balance that survives is the balance they paid for.
//
// 🔒 AND IT IS NEVER A SECOND CURRENCY THE USER HAS TO MANAGE. They are never asked to choose which
// money to spend, no screen shows two numbers, and nothing expires. The only moment the distinction
// is ever visible is the one moment it has to be: buying a plan with nothing but gift money.
//
// PURE — no Firestore, no clock, no env.

/** The wallet fields this rule reads. Everything is `unknown` because a wallet doc is untyped JSON. */
export interface GiftWalletView {
  tokenBalance?: unknown;
  /** Maintained by this module. ABSENT on every wallet written before 2026-09-13 — see `giftRemaining`. */
  giftTokensRemaining?: unknown;
  /** Gross ₹ the user has ever paid us. Set by the real-money credit path only. */
  total_money_spent?: unknown;
  /** ISO timestamp of the last real payment, or null/absent for a user who has never paid. */
  lastRechargeAt?: unknown;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** True when this wallet has never received real money — the one thing we can know for certain. */
export function hasEverPaid(w: GiftWalletView | null | undefined): boolean {
  const wallet = w || {};
  if (num(wallet.total_money_spent) > 0) return true;
  const last = wallet.lastRechargeAt;
  return typeof last === 'string' && last.trim() !== '';
}

/**
 * How much of the current balance is gift money.
 *
 * 🔴 THE MIGRATION, AND IT IS A JUDGEMENT CALL RATHER THAN A FACT. Wallets written before this rule
 * existed carry no `giftTokensRemaining`, and there is no way to reconstruct it: `freeGiftedTokens`
 * is the LIFETIME total ever gifted, not what survives, and nothing recorded which rupees a past
 * build spent. Two honest readings, and they fail in opposite directions:
 *
 *   • a user who has NEVER paid us → every token they hold came from us. That is not an estimate,
 *     it is arithmetic, so the whole balance is treated as gift and the plan is refused. This is
 *     precisely the case the admin named, and it is the case we can be certain about.
 *
 *   • a user who HAS paid us → we cannot tell how much of what is left is theirs. Treating it as
 *     paid lets a little old gift money through exactly once; treating it as gift tells somebody who
 *     really paid us that their money is not real. The second is far worse — for them and for us —
 *     so a past payer is trusted.
 *
 * The uncertainty is bounded and temporary: every wallet touched after this ships carries the real
 * number, so the guess applies only to balances that already existed on the day it shipped.
 */
export function giftRemaining(w: GiftWalletView | null | undefined): number {
  const wallet = w || {};
  const balance = Math.max(0, num(wallet.tokenBalance));
  const tracked = wallet.giftTokensRemaining;
  if (typeof tracked === 'number' && Number.isFinite(tracked)) {
    // Clamped to the balance: the gift can never exceed the money that is actually there, whatever
    // an older or partially-written document happens to say.
    return Math.min(balance, Math.max(0, tracked));
  }
  return hasEverPaid(wallet) ? 0 : balance;
}

/** The part of the balance a plan may be bought with. Never negative, never above the balance. */
export function paidSpendableTokens(w: GiftWalletView | null | undefined): number {
  const balance = Math.max(0, num((w || {}).tokenBalance));
  return Math.max(0, balance - giftRemaining(w));
}

/**
 * The new gift figure after ORDINARY spending (a build, a chat turn, hosting traffic).
 *
 * Gift absorbs the charge first; once it is exhausted the rest comes out of paid money and the gift
 * simply stays at zero. `tokensDebited` may legitimately be 0 (a charge under one whole token).
 */
export function giftAfterSpend(w: GiftWalletView | null | undefined, tokensDebited: number): number {
  const spent = Math.max(0, num(tokensDebited));
  return Math.max(0, giftRemaining(w) - spent);
}

/**
 * The new gift figure after a GIFT credit — the welcome bonus, a weekly top-up, a coupon, an admin
 * grant. All of them are money the user did not pay, so all of them are bound by this rule.
 *
 * ⚠️ An ADMIN adjustment counts as a gift on purpose. An admin handing out tokens is NavBharatAI
 * giving something away, whatever the reason; if it is meant to settle a real payment the payment
 * path is what should record it, because that is the path that also proves the money arrived.
 */
export function giftAfterGrant(w: GiftWalletView | null | undefined, tokensGranted: number): number {
  const granted = Math.max(0, num(tokensGranted));
  return giftRemaining(w) + granted;
}

/** What the user is told when their balance is real but all of it is ours. Never a bare error. */
export interface GiftRefusal {
  giftTokens: number;
  paidTokens: number;
  neededTokens: number;
  shortfallTokens: number;
}

/**
 * Can this wallet buy something at `neededTokens`? Returns null when it can, or the numbers behind
 * the refusal when it cannot — so the caller can say what is missing instead of "not enough".
 */
export function checkPlanPayable(
  w: GiftWalletView | null | undefined,
  neededTokens: number,
): GiftRefusal | null {
  const needed = Math.max(0, num(neededTokens));
  const paid = paidSpendableTokens(w);
  if (paid >= needed) return null;
  return {
    giftTokens: giftRemaining(w),
    paidTokens: paid,
    neededTokens: needed,
    shortfallTokens: Math.ceil(needed - paid),
  };
}
