// ONE RULE FOR EVERY WALLET CREDIT: MOVE BOTH VIEWS, BY THE SAME MONEY.
//
// ── WHY THIS FILE EXISTS (money audit, 2026-09-12) ───────────────────────────────────────────────
// The wallet keeps the SAME money in two fields — `tokenBalance` (tokens) and `remaining_balance` (₹)
// — because different parts of the platform read different ones: the affordability gate reads ₹, the
// spend path debits tokens. That is workable only while every writer moves BOTH by the same amount.
// Two writers did not, and each was wrong in its own direction:
//
//   • The COUPON redemption credited ₹ ONLY. The token view never saw the money.
//   • The ADMIN token adjustment did the opposite and worse: it OVERWROTE `remaining_balance` with
//     `tokenBalance / TOKENS_PER_RUPEE` — not a delta, an assignment. For any user whose two views
//     legitimately differ it silently rewrote a real balance. And they DO legitimately differ: a Pass
//     purchase credits `remaining_balance += netPaid` while the token figure was computed separately,
//     the Pass price first, so a Pass buyer's views differ by exactly the Pass price, forever. A "+1
//     token" adjustment on that account would have wiped ₹(pass price) the user had really paid — and
//     on an account credited the other way round, minted balance nobody paid for.
//
// 🔒 THE INVARIANT, and it is the whole point: a credit is an amount of MONEY, expressed twice. So
// this module takes the delta ONCE and derives both fields from it. There is no way to call it and
// move one view without the other, which is what made the two bugs above possible.
//
// 🔒 AND IT NEVER ASSIGNS — every field is `current + delta`. An assignment cannot be made safe by a
// transaction: it discards whatever the other view legitimately held. A delta survives concurrency
// (re-applied on a retry) AND legitimate divergence (it preserves it).
//
// PURE — no Firestore, no clock. The caller applies the patch INSIDE a transaction; that half cannot
// live here, and `walletCreditIsTransactional` in the tests is what pins it at the call sites.

import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';
import { giftAfterGrant, giftRemaining, type GiftWalletView } from './giftSpend';

/** The two views of one balance, as they sit on the wallet document. */
export interface WalletViews extends GiftWalletView {
  tokenBalance?: unknown;
  remaining_balance?: unknown;
  total_balance?: unknown;
}

/**
 * Whose money this credit is (`giftSpend.ts`).
 *
 * 🔒 REQUIRED, WITH NO DEFAULT, AND THAT IS THE POINT. A default would decide the question silently
 * for whoever adds the next credit path, and silence is exactly how the coupon writer came to move
 * one view and not the other. Making the compiler ask means a new writer cannot ship without an
 * answer: 'gift' is anything NavBharatAI hands over (welcome bonus, weekly top-up, coupon, admin
 * grant); 'paid' is money that genuinely arrived from the user.
 */
export type CreditSource = 'gift' | 'paid';

/** The fields a credit writes. `total_balance` is the lifetime figure and only ever grows. */
export interface MirroredPatch {
  tokenBalance: number;
  remaining_balance: number;
  total_balance?: number;
  /** How much of the new balance is gift money. Written on every credit, so it can never go stale. */
  giftTokensRemaining: number;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** ₹ → tokens, at the one rate the whole platform uses. PURE. */
export function rupeesToTokens(inr: number): number {
  if (!Number.isFinite(inr)) return 0;
  return Math.round(inr * TOKENS_PER_RUPEE);
}

/**
 * The patch that moves BOTH views of the wallet by `tokensDelta`.
 *
 * `tokensDelta` may be negative (an admin deduction). Both views are floored at zero TOGETHER — from
 * the SAME clamped token figure — so a deduction larger than the balance can never leave one view at
 * zero and the other negative, which is how a "corrected" wallet ends up owing itself money.
 *
 * `total_balance` (the lifetime-credited figure) is moved only by a genuine CREDIT: a deduction is not
 * an un-purchase, and reducing it would misreport what the user has ever put in.
 */
export function mirroredCreditPatch(
  current: WalletViews | null | undefined,
  tokensDelta: number,
  source: CreditSource,
): MirroredPatch {
  const w = current || {};
  const delta = Number.isFinite(tokensDelta) ? tokensDelta : 0;
  const heldTokens = num(w.tokenBalance);
  const nextTokens = Math.max(0, heldTokens + delta);
  // The amount that ACTUALLY moved after the floor — so ₹ follows the real change, not the requested
  // one. Asking to remove 500 tokens from a 100-token wallet moves 100, and ₹ moves by 100's worth.
  const appliedTokens = nextTokens - heldTokens;
  const appliedInr = TOKENS_PER_RUPEE > 0 ? appliedTokens / TOKENS_PER_RUPEE : 0;

  // A GIFT raises the gift figure; PAID money leaves it alone. Either way it is clamped to the new
  // balance, so a DEDUCTION (a negative delta, which only the admin path sends) takes the gift down
  // with it rather than leaving a wallet claiming more gift than it holds money.
  const giftNow = source === 'gift' && appliedTokens > 0
    ? giftAfterGrant(w, appliedTokens)
    : giftRemaining(w);

  const patch: MirroredPatch = {
    tokenBalance: nextTokens,
    remaining_balance: Math.max(0, num(w.remaining_balance) + appliedInr),
    giftTokensRemaining: Math.max(0, Math.min(giftNow, nextTokens)),
  };
  if (appliedTokens > 0) patch.total_balance = num(w.total_balance) + appliedInr;
  return patch;
}
