// HOW MANY TOKENS ONE PAID ORDER PUT INTO A WALLET — one home for the arithmetic, read by the credit
// AND by the refund clawback.
//
// 🔒 WHY THIS IS ITS OWN MODULE (Q-614, 2026-10-05). A refund must remove exactly the tokens the
// payment bought, so the clawback needs the SAME formula the credit used. Re-deriving it in the refund
// code would be the money rule with two homes that `payments.ts`'s own header warns about — the two
// copies free to drift, and a refund then taking more (or less) than the payment ever added. These
// functions used to live in `payments.ts`; they moved here because the refund store has to read them,
// and `payments.ts` has to call the refund store (a gift order refunded before its code was minted),
// so leaving them there would have made an import cycle on the money path. `payments.ts` re-exports
// every name, so no existing importer changes.
//
// PURE. No Firestore, no clock, no env.

import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';

export interface WalletCreditTx {
  userId: string;
  amountPaid: number;
  balanceAdded: number;
  /**
   * The platform fee this payment carried, in ₹ — written by the route that CREATED the order, from
   * the rate that was disclosed to the user on that screen. Absent on a transaction created before
   * the fee existed, and absent on a store purchase (Play/Apple packs are priced with their fee
   * already inside), and absent means ZERO: those credit in full, exactly as they were sold.
   */
  platformFeeInr?: number;
}

/** Tokens a purchase credits, derived ONLY from the amount actually paid (net of our fee). Pure. */
export function creditableTokens(netPaidRupees: unknown): number {
  const paid = Number(netPaidRupees);
  if (!Number.isFinite(paid) || paid <= 0) return 0;
  return Math.round(paid * TOKENS_PER_RUPEE);
}

/**
 * The platform fee actually recorded on a transaction.
 *
 * 🔑 READ FROM THE TRANSACTION, NOT RE-COMPUTED FROM THE CURRENT RATE. The user agreed to a split on
 * the screen where they paid; if the admin changes the rate while an order sits pending, re-deriving
 * it here would credit a different amount than the one they were shown. The stored number is written
 * by our own route, never by the client, so reading it is not trusting the caller.
 *
 * Clamped to [0, amountPaid] so no corrupt or hand-edited row can ever produce a negative credit.
 */
export function recordedPlatformFee(txData: WalletCreditTx): number {
  const paid = Number(txData.amountPaid);
  const fee = Number(txData.platformFeeInr);
  if (!Number.isFinite(paid) || paid <= 0) return 0;
  if (!Number.isFinite(fee) || fee <= 0) return 0;
  return Math.min(fee, paid);
}

/**
 * The ₹ a wallet credit is computed from: the paid amount net of the recorded platform fee.
 *
 * ⚠️ `amountPaid` is read as a NUMBER ONLY (a string or NaN counts as 0), exactly as
 * `computeCreditedWallet` has always read it — a looser read here would let the refund side compute a
 * credit the credit side never made.
 */
export function orderNetPaidInr(txData: WalletCreditTx): number {
  const amountPaid = typeof txData.amountPaid === 'number' && Number.isFinite(txData.amountPaid) ? txData.amountPaid : 0;
  return Math.round((amountPaid - recordedPlatformFee(txData)) * 100) / 100;
}

/** The tokens a wallet order credits — the ONE formula both the credit and the clawback use. */
export function orderCreditedTokens(txData: WalletCreditTx): number {
  return creditableTokens(orderNetPaidInr(txData));
}
