// A BRAND-NEW WALLET STARTS AT ₹0 (admin 2026-09-26: "100*4 ko chor ke sab hata do").
//
// NavBharatAI gives new money in exactly one way: the referral ladder (`referralRewards.ts`), ₹100 for
// each of four verified steps, claimed in the Android app. Every other welcome grant is gone from the
// code — the legacy flat bonus, the ₹250/₹500 v2 plan and its phone-bonus claim, the weekly top-up
// ladder, the ₹50 interim credit, and the ₹250 backfill. So opening a wallet grants nothing, and this
// module only builds the empty document.
//
// ⚠️ WHAT THIS DOES NOT UNDO. Wallets that already received a welcome grant keep it, with its ledger
// row and its `payment_transactions/welcome_<uid>` record. Removing a programme never takes money back.
//
// PURE — the caller owns persistence.

export interface NewWalletInput {
  userId: string;
  email: string;
  name: string;
  /** ISO timestamp, injected so the builder stays pure and testable. */
  nowIso: string;
}

/**
 * The document a wallet is created with. An empty ledger and a ₹0 balance satisfy the statement
 * invariant (opening + Σ rows = balance) trivially.
 *
 * `freeGiftedTokens` and `giftTokensRemaining` start at 0 on purpose: the referral ladder reads the
 * first to hold every account under its ₹400 lifetime ceiling, and `giftSpend.ts` reads the second to
 * keep gifted money from buying a hosting plan. Both only ever grow from a real referral credit.
 */
export function buildEmptyWallet(i: NewWalletInput): Record<string, unknown> {
  return {
    userId: i.userId,
    userEmail: i.email,
    userName: i.name,
    total_balance: 0,
    remaining_balance: 0,
    total_output_tokens_used: 0,
    total_money_spent: 0,
    tokenBalance: 0,
    totalTokensPurchased: 0,
    totalTokensUsed: 0,
    lastRechargeAt: null,
    createdAt: i.nowIso,
    freeGiftedTokens: 0,
    giftTokensRemaining: 0,
    walletLedger: [],
    updatedAt: i.nowIso,
  };
}
