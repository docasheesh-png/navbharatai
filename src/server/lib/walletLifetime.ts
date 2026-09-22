// ONE READER FOR A WALLET'S LIFETIME TOTALS — because the same three facts were written under one
// spelling and read under another, and the admin panel showed ₹0 / 0 tokens for every user.
//
// 🔴 THE DEFECT (found 2026-09-17 while auditing the admin Revenue and Users pages). The ONLY writers
// that ever increment a wallet's lifetime figures use camelCase:
//
//     payments.ts     update.totalMoneySpent  = n(w.totalMoneySpent)  + amountPaid;   // real money in
//     walletDebit.ts  totalTokensUsed         = n(w.totalTokensUsed)  + tokens;       // credits out
//     payments.ts     update.totalTokensPurchased = …                                   // credits in
//
// …while the admin Users list, the "Top Consuming Users" table and the account sheet read
// `total_money_spent` and `total_output_tokens_used` — snake_case fields that are written EXACTLY
// ONCE, as `0`, when a wallet is created, and never touched again. So "Total Used: 0" and
// "Money Spent: ₹0" for every account, on the screens used to judge who pays and who consumes.
// `giftSpend`'s paid-predicate read the same dead field and only worked because it ALSO checks
// `lastRechargeAt` (renamed `walletMayBuyWithItsBalance` on 2026-09-21). ⚠️ On that date
// `FreeTierBuildRouting.hasEverPaid` was found STILL bypassing this file — reading `totalMoneySpent`
// alone — which is exactly the return this docblock warns about, on the predicate that decides
// whether somebody is routed to the cheap engines. It goes through here now.
//
// 🔑 FIXED AS A CLASS: every reader goes through here, and the reader accepts BOTH spellings. It
// takes the MAX, never the sum — a wallet that carries both (an account merged by `accountMerge.ts`,
// which writes both) must not be counted twice, and a wallet that carries only the live camelCase
// figure must not be read as zero. A new writer that picks either spelling is still read correctly;
// a new READER that bypasses this file is the only way the bug comes back, which is why the wiring
// is test-locked in `tests/walletLifetime.test.ts`.
//
// PURE. Everything is `unknown` because a wallet document is untyped JSON.

export interface WalletLifetimeView {
  totalMoneySpent?: unknown;
  total_money_spent?: unknown;
  totalTokensUsed?: unknown;
  total_output_tokens_used?: unknown;
  totalTokensPurchased?: unknown;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Gross rupees this wallet has ever paid us (fee included). 0 when neither spelling carries a figure. */
export function lifetimeMoneySpentInr(w: WalletLifetimeView | null | undefined): number {
  const wallet = w || {};
  return Math.round(Math.max(num(wallet.totalMoneySpent), num(wallet.total_money_spent)) * 100) / 100;
}

/** Credits (tokens) this wallet has ever had debited — builds, assistants, tools, hosting, all of it. */
export function lifetimeTokensUsed(w: WalletLifetimeView | null | undefined): number {
  const wallet = w || {};
  return Math.floor(Math.max(num(wallet.totalTokensUsed), num(wallet.total_output_tokens_used)));
}

/** Credits (tokens) ever credited — purchases, gifts and referral steps alike. */
export function lifetimeTokensPurchased(w: WalletLifetimeView | null | undefined): number {
  return Math.floor(num((w || {}).totalTokensPurchased));
}
