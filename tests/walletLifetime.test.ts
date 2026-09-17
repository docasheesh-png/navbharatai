/**
 * ONE READER FOR A WALLET'S LIFETIME TOTALS — `walletLifetime.ts` (found 2026-09-17).
 *
 * THE EXACT FAILURE: the real-money credit path increments `totalMoneySpent` and every debit
 * increments `totalTokensUsed` (camelCase), while the admin Users list, the "Top Consuming Users"
 * table and the account sheet read `total_money_spent` / `total_output_tokens_used` — written once,
 * as 0, at wallet creation. Every account showed ₹0 paid and 0 tokens used.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { lifetimeMoneySpentInr, lifetimeTokensUsed, lifetimeTokensPurchased } from '../src/server/lib/walletLifetime';
import { hasEverPaid } from '../src/server/lib/giftSpend';
import { mergeWallets } from '../src/server/lib/accountMerge';

describe('a wallet as the credit and debit paths actually write it', () => {
  const live = { totalMoneySpent: 1499, totalTokensUsed: 120_345, totalTokensPurchased: 200_000, total_money_spent: 0, total_output_tokens_used: 0 };
  it('reads the live camelCase figures — the case that showed ₹0 / 0 for everyone', () => {
    expect(lifetimeMoneySpentInr(live)).toBe(1499);
    expect(lifetimeTokensUsed(live)).toBe(120_345);
    expect(lifetimeTokensPurchased(live)).toBe(200_000);
  });
  it('still reads a legacy wallet that only carries the snake_case spelling', () => {
    expect(lifetimeMoneySpentInr({ total_money_spent: 250 })).toBe(250);
    expect(lifetimeTokensUsed({ total_output_tokens_used: 999 })).toBe(999);
  });
  it('takes the larger of the two, never the sum — a merged wallet carries both', () => {
    expect(lifetimeMoneySpentInr({ totalMoneySpent: 500, total_money_spent: 500 })).toBe(500);
    expect(lifetimeTokensUsed({ totalTokensUsed: 10, total_output_tokens_used: 4 })).toBe(10);
  });
  it('unreadable, negative or absent values read as 0', () => {
    expect(lifetimeMoneySpentInr({ totalMoneySpent: 'x' as never })).toBe(0);
    expect(lifetimeMoneySpentInr({ totalMoneySpent: -5 })).toBe(0);
    expect(lifetimeTokensUsed(null)).toBe(0);
    expect(lifetimeTokensPurchased(undefined)).toBe(0);
    expect(lifetimeMoneySpentInr({ totalMoneySpent: '12.5' })).toBe(12.5);
  });
});

describe('siblings that read the same fact', () => {
  it('hasEverPaid recognises a paying user from the LIVE field, without needing lastRechargeAt', () => {
    expect(hasEverPaid({ tokenBalance: 10, totalMoneySpent: 99 })).toBe(true);
    expect(hasEverPaid({ tokenBalance: 10, total_money_spent: 99 })).toBe(true);
    expect(hasEverPaid({ tokenBalance: 10, totalMoneySpent: 0, total_money_spent: 0 })).toBe(false);
  });
  it('a merge carries the retired wallet\'s real payments in the live field', () => {
    const into = { userId: 'a', tokenBalance: 100, totalTokensPurchased: 100, totalTokensUsed: 0, totalMoneySpent: 100, walletLedger: [] };
    const other = { userId: 'b', tokenBalance: 50, totalTokensPurchased: 50, totalTokensUsed: 0, totalMoneySpent: 250, walletLedger: [] };
    const merged = mergeWallets(into, other, '2026-09-17T00:00:00.000Z').wallet;
    expect(lifetimeMoneySpentInr(merged)).toBe(350);
    expect(merged.totalMoneySpent).toBe(350);
  });
});

describe('wiring — the admin readers go through the ONE reader (comments stripped)', () => {
  const code = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').split('\n')
    .filter((l) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); }).join('\n');

  it('the users list and the top-consumers table no longer read the dead fields', () => {
    const src = code('src/server/routes/admin.ts');
    expect(src).toContain('totalTokensUsed: lifetimeTokensUsed(u)');
    expect(src).toContain('moneySpent: lifetimeMoneySpentInr(u)');
    expect(src).toContain('totalTokensPurchased: lifetimeTokensPurchased(u)');
    expect(src).toContain('tokens_used: lifetimeTokensUsed(w)');
    expect(src).toContain('money_spent: lifetimeMoneySpentInr(w)');
    expect(src).not.toContain('u.total_output_tokens_used || 0');
    expect(src).not.toContain('w.total_money_spent || 0');
  });
  it('the account sheet reads money spent through the reader', () => {
    const src = code('src/server/routes/reports.ts');
    expect(src).toContain('totalSpentInr: lifetimeMoneySpentInr(w)');
    expect(src).not.toContain('Number(w.total_money_spent ?? 0)');
  });
});
