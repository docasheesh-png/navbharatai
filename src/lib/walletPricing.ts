// WALLET PRICING CONSTANTS — the numbers that must read the same on every screen and on the server.
//
// 🔴 WHY THIS FILE EXISTS (found 2026-09-10, while adding the recharge platform fee). The Vishwakarma
// entry-pass price was written out THREE times with TWO different values: the chooser modal printed
// `vkMode === 'pro' ? 100 : 50` in its price line, its totals box and its buy button, while the order
// it actually created hardcoded ₹100 and the server credited `(paid − 100) × 100` tokens. A user on
// any non-'pro' mode was therefore shown "₹50 + your tokens", charged ₹100 + their tokens, and given
// tokens for the amount they expected — i.e. quietly billed ₹50 more than the screen promised.
//
// That is exactly the class of defect the White-Label Law's other half forbids: the bill a user pays
// must be the real one, and a price shown before payment is part of that bill. The root cause was not
// the wrong literal — it was that a money constant had three homes and was free to drift between
// them. It now has one, and the server re-exports from here rather than keeping its own copy.
//
// PURE. No imports, no env, no I/O.

/**
 * The ₹→wallet-token unit. Used EVERYWHERE money meets tokens (credit mint, build debit, pre-flight
 * estimate display, the 402 payload) so the rate can never drift between surfaces.
 */
export const TOKENS_PER_RUPEE = 100;

/**
 * The Vishwakarma entry pass, in ₹. This is the value the SERVER subtracts before minting tokens
 * (`creditableVishwakarmaTokens`), so it is the only one that can be authoritative: any screen that
 * printed a different number would be describing a payment that will not happen.
 */
export const VISHWAKARMA_PASS_PRICE_INR = 100;
