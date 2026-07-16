// Account/wallet MERGE — the money-critical core of "one person = one wallet" (admin 2026-07-16).
//
// When two wallets are PROVEN to belong to the same person (via account-linking — NEVER from merely
// fetching someone's GitHub repo), they must be combined into one HONESTLY:
//   • Debt carries. A negative (overdrafted) balance reduces the merged balance — a user can never
//     escape their own debt by starting a fresh account. (Admin's exact case: paid ₹100 + an old
//     account that overdrafted → net, not ₹100.)
//   • The welcome bonus counts ONCE per person, never once-per-account — otherwise linking N accounts
//     would farm N × 50,000 free tokens.
//   • Real purchases (actual ₹ paid) all carry — the user keeps every rupee they really spent.
//
// The safe way to satisfy all three at once is to reconstruct the merged balance FROM FIRST PRINCIPLES
// (real tokens purchased − tokens used + one welcome), NOT by naively summing the two current balances
// (which would double the welcome bonus and mis-handle a partially-spent bonus). PURE + unit-tested; the
// CALLER owns the "is this really the same person?" proof — this module never decides identity.

import { TOKENS_PER_RUPEE, welcomeBonusTokens } from './payments';
import { MAX_WALLET_LEDGER_ENTRIES } from './walletDebit';

type Wallet = Record<string, any>;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Did this wallet ever receive the welcome bonus? Detected from the ledger entry buildInitialWallet
 *  writes ("Welcome Bonus: … AI Tokens Credited!"). A person who has ANY such wallet has had their one. */
export function walletReceivedWelcome(w: Wallet | null | undefined): boolean {
  const ledger = Array.isArray(w?.walletLedger) ? w!.walletLedger : [];
  return ledger.some((e: any) => typeof e?.description === 'string' && /welcome bonus/i.test(e.description));
}

/** Real (non-welcome) tokens this wallet actually PURCHASED with money = totalTokensPurchased minus the
 *  one welcome grant it may have included. Never negative. */
export function realPurchasedTokens(w: Wallet | null | undefined, welcomeTokens: number): number {
  const purchased = num(w?.totalTokensPurchased);
  const welcome = walletReceivedWelcome(w) ? welcomeTokens : 0;
  return Math.max(0, purchased - welcome);
}

export interface MergeResult {
  wallet: Wallet;
  /** Honest audit of how the merged balance was derived (for the merge ledger entry + admin log). */
  audit: {
    realPurchasedTokens: number;
    welcomeTokensGranted: number;
    totalTokensUsed: number;
    mergedTokenBalance: number;
    bothHadWelcome: boolean;
  };
}

/**
 * PURE merge of two wallets that belong to the SAME person. Reconstructs the balance as
 *   realPurchased(A) + realPurchased(B) + ONE welcome (if either got it) − used(A) − used(B)
 * so debt carries, purchases carry, and the welcome bonus is counted exactly once. The ledgers are
 * concatenated (newest-first, bounded) with an honest merge marker prepended. `nowIso` is injected.
 *
 * `into` is the wallet whose identity/email/name the merged doc keeps (usually the current login).
 */
export function mergeWallets(into: Wallet, other: Wallet, nowIso: string): MergeResult {
  const welcome = welcomeBonusTokens();
  const bothHadWelcome = walletReceivedWelcome(into) && walletReceivedWelcome(other);
  const eitherHadWelcome = walletReceivedWelcome(into) || walletReceivedWelcome(other);

  const realPurchased = realPurchasedTokens(into, welcome) + realPurchasedTokens(other, welcome);
  const welcomeGranted = eitherHadWelcome ? welcome : 0;
  const totalUsed = num(into.totalTokensUsed) + num(other.totalTokensUsed);

  // Balance from first principles — this is what prevents welcome-farming AND carries debt.
  const mergedTokenBalance = realPurchased + welcomeGranted - totalUsed;
  const mergedRemainingInr = Math.round((mergedTokenBalance / TOKENS_PER_RUPEE) * 100) / 100;

  const outputUsed = num(into.total_output_tokens_used) + num(other.total_output_tokens_used);
  const moneySpent = num(into.total_money_spent) + num(other.total_money_spent);
  const purchasedTotal = realPurchased + welcomeGranted; // keep the invariant balance = purchased − used

  const pickLater = (a: unknown, b: unknown): string | null => {
    const ta = typeof a === 'string' ? Date.parse(a) : NaN;
    const tb = typeof b === 'string' ? Date.parse(b) : NaN;
    if (Number.isNaN(ta)) return typeof b === 'string' ? (b as string) : null;
    if (Number.isNaN(tb)) return a as string;
    return ta >= tb ? (a as string) : (b as string);
  };
  const pickEarlier = (a: unknown, b: unknown): string | null => {
    const ta = typeof a === 'string' ? Date.parse(a) : NaN;
    const tb = typeof b === 'string' ? Date.parse(b) : NaN;
    if (Number.isNaN(ta)) return typeof b === 'string' ? (b as string) : null;
    if (Number.isNaN(tb)) return a as string;
    return ta <= tb ? (a as string) : (b as string);
  };

  const mergeEntry = {
    type: 'admin_adjustment' as const,
    amountCoinsOrTokens: mergedTokenBalance - num(into.tokenBalance),
    moneySpent: 0,
    timestamp: nowIso,
    description: `Accounts merged — combined balance ${mergedTokenBalance.toLocaleString()} tokens (real purchases + one welcome − usage).`,
  };
  const ledger = [
    mergeEntry,
    ...(Array.isArray(into.walletLedger) ? into.walletLedger : []),
    ...(Array.isArray(other.walletLedger) ? other.walletLedger : []),
  ].slice(0, MAX_WALLET_LEDGER_ENTRIES);

  const wallet: Wallet = {
    ...into,
    tokenBalance: mergedTokenBalance,
    remaining_balance: mergedRemainingInr,
    total_balance: mergedRemainingInr,
    totalTokensPurchased: purchasedTotal,
    totalTokensUsed: num(into.totalTokensUsed) + num(other.totalTokensUsed),
    total_output_tokens_used: outputUsed,
    total_money_spent: moneySpent,
    hasVishwakarmaPass: !!(into.hasVishwakarmaPass || other.hasVishwakarmaPass),
    vishwakarmaPassActivatedAt: pickEarlier(into.vishwakarmaPassActivatedAt, other.vishwakarmaPassActivatedAt),
    lastRechargeAt: pickLater(into.lastRechargeAt, other.lastRechargeAt),
    walletLedger: ledger,
    updatedAt: nowIso,
  };

  return {
    wallet,
    audit: { realPurchasedTokens: realPurchased, welcomeTokensGranted: welcomeGranted, totalTokensUsed: totalUsed, mergedTokenBalance, bothHadWelcome },
  };
}
