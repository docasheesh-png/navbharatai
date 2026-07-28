// Welcome-bonus grant logic — PURE + unit-tested (admin money bug 2026-07-12: "logout→login par har baar
// 50,000 token free me aa rahe hai").
//
// ROOT CAUSE it fixes: the welcome bonus used to be granted whenever the wallet DOC did not exist. A wallet
// doc can be re-created (a lost/absent doc, a DB migration, a pre-migration write that never persisted), and
// each recreation re-granted 50,000 tokens — an infinite free-token farm via logout→login. The bonus must be
// idempotent against a DURABLE per-user marker (the `payment_transactions/welcome_${userId}` doc, which lives
// in a SEPARATE collection and survives wallet recreation), NOT against the recreatable wallet doc.

import { TOKENS_PER_RUPEE, welcomeBonusTokens } from './payments';

/**
 * How many welcome-bonus tokens to grant when (re)creating a wallet: the configured bonus ONLY if the user
 * has NEVER received it (no durable marker), else 0. Pure — the caller supplies the marker-exists flag.
 */
export function welcomeGrantTokens(alreadyGranted: boolean): number {
  return alreadyGranted ? 0 : welcomeBonusTokens();
}

export interface NewWalletInput {
  userId: string;
  email: string;
  name: string;
  /** Result of welcomeGrantTokens() — 0 when the bonus was already granted before (no re-grant). */
  welcomeTokens: number;
  /** ISO timestamp (injected so the builder stays pure/testable). */
  nowIso: string;
}

/**
 * Build the initial wallet doc for a (re)created wallet. A 0-token grant writes an EMPTY ledger and a ₹0
 * balance — no fake "Welcome Bonus" row — so a re-created wallet for a user who already spent their bonus
 * starts empty (they must recharge), never with free tokens. Pure.
 */
export function buildInitialWallet(i: NewWalletInput): Record<string, unknown> {
  const welcomeBalance = i.welcomeTokens / TOKENS_PER_RUPEE;
  return {
    userId: i.userId,
    userEmail: i.email,
    userName: i.name,
    total_balance: welcomeBalance,
    remaining_balance: welcomeBalance,
    total_output_tokens_used: 0,
    total_money_spent: 0,
    hasVishwakarmaPass: false,
    vishwakarmaPassActivatedAt: null,
    tokenBalance: i.welcomeTokens,
    totalTokensPurchased: i.welcomeTokens,
    totalTokensUsed: 0,
    lastRechargeAt: null,
    // Anchors for the weekly free credit (weeklyTopUp.ts): a brand-new wallet starts its week HERE, so
    // the ₹250 signup grant is followed by the first weekly top-up exactly seven days later — never
    // immediately on the next page load.
    createdAt: i.nowIso,
    lastWeeklyTopUpAt: i.nowIso,
    // Running total of everything EVER gifted to this account. The weekly ladder stops permanently once
    // this reaches the lifetime cap (₹650), so it must start at whatever the signup grant actually was.
    freeGiftedTokens: i.welcomeTokens,
    walletLedger:
      i.welcomeTokens > 0
        ? [
            {
              type: 'purchase',
              amountCoinsOrTokens: i.welcomeTokens,
              moneySpent: 0,
              timestamp: i.nowIso,
              description: `Welcome Bonus: ${i.welcomeTokens.toLocaleString()} AI Tokens Credited!`,
            },
          ]
        : [],
    updatedAt: i.nowIso,
  };
}
