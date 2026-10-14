// THE QUICK AMOUNTS ON THE BUY-TOKENS PAGE — and what each one REALLY buys.
//
// 🔴 WHY THESE ARE AMOUNTS, NOT "PACKS". The design brief showed "₹100 = 10,000 tokens". On the web
// rail that is not what happens: the platform fee comes off first (platformFee.ts), so ₹100 credits
// ₹98 = 9,800 tokens, and a card that promised 10,000 would be a price shown before payment that the
// server then contradicts — the exact drift walletPricing.ts was written to end. So each chip below
// does nothing but fill the amount box, and the tokens printed on it come from the SAME pure split
// the server settles with. The user is never shown a number the ledger will later disagree with.
//
// The amounts are suggestions only: nothing here adds a package, a bonus or a discount, and the amount
// box still accepts any ₹1 – ₹9,99,999 the server accepts.
//
// PURE.

import { TOKENS_PER_RUPEE } from './walletPricing';
import { splitPaymentAtPct } from './platformFee';

export const QUICK_AMOUNTS_INR: readonly number[] = Object.freeze([5, 10, 50, 100, 500]);

export interface QuickAmount {
  amountInr: number;
  /** Tokens that reach the wallet for this payment, after the platform fee. */
  tokens: number;
}

/** What `amountInr` credits, by the same arithmetic the server uses. */
export function tokensForPayment(amountInr: number, feePct: number): number {
  const split = splitPaymentAtPct(amountInr, feePct);
  return Math.round(split.creditInr * TOKENS_PER_RUPEE);
}

export function quickAmounts(feePct: number): QuickAmount[] {
  return QUICK_AMOUNTS_INR.map((amountInr) => ({ amountInr, tokens: tokensForPayment(amountInr, feePct) }));
}

/** Is the typed amount one of the chips — so the matching chip can show as selected. */
export function selectedQuickAmount(input: string): number | null {
  const n = Number(input);
  return Number.isFinite(n) && QUICK_AMOUNTS_INR.includes(n) ? n : null;
}
