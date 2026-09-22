/**
 * 🔴 TWO `hasEverPaid`s DISAGREED — AND NEITHER OF THEM WAS THE BUG.
 *
 * `adminUserListQuery.ts` recorded the pair as an open root cause and, rather than pick one,
 * described them exactly:
 *
 *   > *"`AgentV3/FreeTierBuildRouting.hasEverPaid` → `Number(totalMoneySpent) > 0`;
 *   > `lib/giftSpend.hasEverPaid` → `lifetimeMoneySpentInr(w) > 0 || lastRechargeAt`. They disagree
 *   > about a wallet carrying `lastRechargeAt` with no `totalMoneySpent`. … Unifying them is a
 *   > MONEY-SEMANTICS decision (does a recharge timestamp alone make somebody a customer?)"*
 *
 * ## Reading the writer answers the question the note left open
 *
 * `payments.ts` has ONE real-money credit path, and it wrote:
 *
 *     const amountPaid = n(txData.amountPaid);   // n() returns 0 for anything non-finite
 *     …
 *     update.totalMoneySpent = n(w.totalMoneySpent) + amountPaid;
 *     update.lastRechargeAt  = now;              // ← unconditional
 *
 * So a transaction row whose `amountPaid` is absent, a string or NaN — a legacy row, a hand-fixed
 * one, a provider payload that changed shape — and the promo branch above it, all added **₹0** and
 * still stamped the wallet. The wallet then said *"they recharged"* and *"they have paid us
 * nothing"* **at the same time**, and both sentences were read as the answer to "is this a paying
 * customer?" by different modules.
 *
 * **The timestamp was not evidence of payment, so the predicates were arguing about a false fact.**
 * A recharge stamp alone does not make somebody a customer — because the one writer set it when
 * nobody paid. That is the money-semantics answer, and it comes from the code rather than a
 * preference.
 *
 * ## What this suite locks
 *
 * 1. `lastRechargeAt` is written only when money actually arrived. (Reversion-proven.)
 * 2. The build router reads BOTH spellings of the money field, through `walletLifetime.ts` — it was
 *    bypassing the one module written to stop exactly that.
 * 3. The two predicates no longer share a NAME. They still differ on a legacy bare stamp, on
 *    purpose, and that difference is asserted rather than left to a comment.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { computeCreditedWallet } from '../src/server/lib/payments';
import { hasEverPaid, isFreeTierUser } from '../src/server/AgentV3/FreeTierBuildRouting';
import { walletMayBuyWithItsBalance, giftRemaining, paidSpendableTokens } from '../src/server/lib/giftSpend';

const PAYMENTS = readFileSync('src/server/lib/payments.ts', 'utf8');
const ROUTING = readFileSync('src/server/AgentV3/FreeTierBuildRouting.ts', 'utf8');
const GIFT = readFileSync('src/server/lib/giftSpend.ts', 'utf8');

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const NOW = '2026-09-21T10:00:00.000Z';
const empty = () => ({ tokenBalance: 0, totalMoneySpent: 0, totalTokensPurchased: 0, walletLedger: [] });

describe('🔴 A RECHARGE STAMP WITHOUT MONEY', () => {
  it('a real payment stamps the wallet and moves the money', () => {
    const { wallet } = computeCreditedWallet(empty(), { amountPaid: 500, balanceAdded: 500 } as never, null, NOW);
    expect(wallet.totalMoneySpent).toBe(500);
    expect(wallet.lastRechargeAt).toBe(NOW);
  });

  it('🔴 a ₹0 credit no longer claims a recharge happened', () => {
    const { wallet } = computeCreditedWallet(empty(), { amountPaid: 0, balanceAdded: 0 } as never, null, NOW);
    expect(wallet.totalMoneySpent).toBe(0);
    expect(wallet.lastRechargeAt).toBeUndefined();
  });

  it('🔴 an unreadable amount is ₹0 — the shape that made this reachable', () => {
    // `n()` returns 0 for a string, null, undefined or NaN. Each of these used to stamp the wallet.
    for (const amountPaid of ['500', null, undefined, NaN, Infinity] as unknown[]) {
      const { wallet } = computeCreditedWallet(empty(), { amountPaid, balanceAdded: 0 } as never, null, NOW);
      expect(wallet.totalMoneySpent).toBe(0);
      expect(wallet.lastRechargeAt).toBeUndefined();
    }
  });

  it('a promo credit adds tokens and still claims no recharge', () => {
    const { wallet, promoApplied } = computeCreditedWallet(empty(), { amountPaid: 0, balanceAdded: 0 } as never, { mode: 'x' }, NOW);
    expect(promoApplied).toBe(true);
    expect(wallet.tokenBalance).toBeGreaterThan(0);
    expect(wallet.lastRechargeAt).toBeUndefined();
  });

  it('🔒 a wallet that ALREADY carries a stamp keeps it — this only stops a new false one', () => {
    const existing = { ...empty(), lastRechargeAt: '2026-01-01T00:00:00.000Z' };
    const { wallet } = computeCreditedWallet(existing, { amountPaid: 0, balanceAdded: 0 } as never, null, NOW);
    expect(wallet.lastRechargeAt ?? existing.lastRechargeAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('🔒 REVERSION GUARD — the write is gated on money, at source', () => {
    // A behavioural test cannot see an unconditional assignment that happens to be re-added beside
    // the guarded one, and this line decides whether the welcome gift can buy a plan.
    const src = code(PAYMENTS);
    expect(src).toContain('if (amountPaid > 0) update.lastRechargeAt = now;');
    expect(src).not.toMatch(/^\s*update\.lastRechargeAt = now;/m);
  });
});

describe('🔒 THE BUILD ROUTER READS BOTH SPELLINGS', () => {
  it('the live camelCase field makes somebody a customer', () => {
    expect(hasEverPaid({ totalMoneySpent: 500 })).toBe(true);
    expect(isFreeTierUser({ totalMoneySpent: 500 })).toBe(false);
  });

  it('🔴 and so does the snake_case one — it could not see this before', () => {
    // `walletLifetime.ts` exists because the money lives under two names and `accountMerge` writes
    // BOTH. Its docblock: "a new READER that bypasses this file is the only way the bug comes back."
    // This predicate decides whether somebody is routed to the cheap engines.
    expect(hasEverPaid({ total_money_spent: 500 })).toBe(true);
    expect(isFreeTierUser({ total_money_spent: 500 })).toBe(false);
  });

  it('it goes through the shared reader rather than re-deriving the rule', () => {
    const src = code(ROUTING);
    expect(src).toContain("import { lifetimeMoneySpentInr } from '../lib/walletLifetime'");
    expect(src).not.toMatch(/Number\(wallet\?\.totalMoneySpent\)/);
  });

  it('unknown is still not free — zero, absent and unreadable all read as not-yet-paying', () => {
    expect(hasEverPaid(null)).toBe(false);
    expect(hasEverPaid(undefined)).toBe(false);
    expect(hasEverPaid({})).toBe(false);
    expect(hasEverPaid({ totalMoneySpent: 0 })).toBe(false);
    expect(hasEverPaid({ totalMoneySpent: 'abc' })).toBe(false);
  });

  it('🔴 a bare recharge stamp is NOT a customer here — the question the note left open', () => {
    expect(hasEverPaid({ lastRechargeAt: NOW } as never)).toBe(false);
  });
});

describe('🔒 ONE NAME, ONE MEANING', () => {
  it('the gift predicate no longer shares the build router’s name', () => {
    const src = code(GIFT);
    expect(src).toContain('export function walletMayBuyWithItsBalance(');
    expect(src).not.toMatch(/export function hasEverPaid\(/);
  });

  it('they still differ on a legacy bare stamp — deliberately, and in the user’s favour', () => {
    const stampOnly = { tokenBalance: 50_000, lastRechargeAt: '2026-01-01T00:00:00.000Z' };
    // A wrong `false` here would tell somebody who really paid that their money is not real.
    expect(walletMayBuyWithItsBalance(stampOnly)).toBe(true);
    expect(giftRemaining(stampOnly)).toBe(0);
    expect(paidSpendableTokens(stampOnly)).toBe(50_000);
    // …while the engine still will not call them a customer without money.
    expect(hasEverPaid(stampOnly as never)).toBe(false);
  });

  it('🔴 a never-paid wallet’s whole balance is still gift — the admin’s own rule', () => {
    // "gift (free welcome gift from navbharatai) plan purchase me kam nahi ayenge!!!!!"
    const legacy = { tokenBalance: 50_000 };
    expect(walletMayBuyWithItsBalance(legacy)).toBe(false);
    expect(giftRemaining(legacy)).toBe(50_000);
    expect(paidSpendableTokens(legacy)).toBe(0);
  });

  it('a tracked wallet is unaffected by any of this', () => {
    // The predicate is only consulted when `giftTokensRemaining` is absent.
    expect(giftRemaining({ tokenBalance: 900, giftTokensRemaining: 400, lastRechargeAt: NOW })).toBe(400);
  });
});
