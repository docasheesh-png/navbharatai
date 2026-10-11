/**
 * Audit 2026-10-11, D5/D6/D10: admin screens and housekeeping that read far more than they use, on the same
 * instances that serve users.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { WALLET_SUMMARY_FIELDS, project, revenueToday } from '../src/server/lib/adminReadFields';
import { lifetimeMoneySpentInr, lifetimeTokensUsed, lifetimeTokensPurchased } from '../src/server/lib/walletLifetime';
import { walletPassesPaidFilter } from '../src/server/lib/adminUserListQuery';

const ADMIN = readFileSync('src/server/routes/admin.ts', 'utf8');

describe('D6 — the admin screens read only the wallet fields they use', () => {
  const wallet = {
    userId: 'u1', userEmail: 'a@b.c', userName: 'A', remaining_balance: 12.5, tokenBalance: 1250,
    totalTokensUsed: 900, total_output_tokens_used: 1200, totalTokensPurchased: 3000,
    totalMoneySpent: 30, total_money_spent: 25, lastRechargeAt: '2026-10-01', banned: false,
    createdAt: '2026-01-01', updatedAt: '2026-10-10',
    walletLedger: Array.from({ length: 500 }, (_, i) => ({ i, note: 'x'.repeat(200) })),
  };
  const projected = project(wallet, WALLET_SUMMARY_FIELDS);

  it('the projection drops the ledger', () => {
    expect(projected).not.toHaveProperty('walletLedger');
  });

  it('every reader the screens use answers exactly as on the full wallet', () => {
    expect(lifetimeMoneySpentInr(projected)).toBe(lifetimeMoneySpentInr(wallet));
    expect(lifetimeTokensUsed(projected)).toBe(lifetimeTokensUsed(wallet));
    expect(lifetimeTokensPurchased(projected)).toBe(lifetimeTokensPurchased(wallet));
    for (const f of ['paid', 'unpaid', 'all'] as const) expect(walletPassesPaidFilter(projected, f)).toBe(walletPassesPaidFilter(wallet, f));
  });

  it('the routes use the projection, a COUNT and a SUM — never a whole-collection read of wallets', () => {
    expect(ADMIN).toMatch(/collection\('user_token_wallets'\)\.select\(\.\.\.WALLET_SUMMARY_FIELDS\)\.get\(\)/);
    expect(ADMIN).toMatch(/collection\('user_token_wallets'\)\.count\(\)\.get\(\)/);
    expect(ADMIN).toMatch(/aggregate\(\{ total: AggregateField\.sum\('amountPaid'\) \}\)/);
    // Exactly one whole-wallet read remains, on purpose: the bulk welcome gift decides a PAYMENT from many
    // fields, and a projection that missed one would decide it on `undefined`.
    const whole = ADMIN.match(/getDocs\(collection\([^)]*'user_token_wallets'\)\)/g) ?? [];
    expect(whole).toHaveLength(1);
    const at = ADMIN.indexOf(whole[0]);
    expect(ADMIN.slice(at - 400, at)).toMatch(/The WHOLE wallet, deliberately/);
  });
});

describe('the revenue badge counts today (it showed ₹0: ISO times parsed with Number())', () => {
  const from = Date.parse('2026-10-11T00:00:00.000Z');
  it('both spellings of the time field, SUCCESS rows only', () => {
    expect(revenueToday([
      { paymentStatus: 'SUCCESS', amountPaid: 100, createdAt: '2026-10-11T05:00:00.000Z' },
      { paymentStatus: 'SUCCESS', amountPaid: 50, createdAt: from + 1_000 },
      { paymentStatus: 'PENDING', amountPaid: 999, createdAt: '2026-10-11T06:00:00.000Z' },
      { paymentStatus: 'SUCCESS', amountPaid: 7, createdAt: '2026-10-10T23:59:59.000Z' },
    ], from)).toBe(150);
  });
  it('the old parse is gone', () => {
    expect(ADMIN).not.toMatch(/Number\(tx\.createdAt \?\? tx\.created_at \?\? 0\)/);
  });
});

describe('D5 and D10 — paged and reference-only reads', () => {
  it('the admin diagnostics listing reads pages of at most 50 reports', () => {
    const src = readFileSync('src/server/AgentV3/DiagnosticsStore.ts', 'utf8');
    expect(src).toMatch(/const LIST_PAGE = 50;/);
    expect(src).toMatch(/page = q\.startAfter\(snap\.docs\[snap\.docs\.length - 1\]\)\.limit\(take\);/);
  });
  it('trimming saved versions reads references, not file sets', () => {
    expect(readFileSync('src/server/project/BuildHistoryStore.ts', 'utf8')).toMatch(/col\.orderBy\('createdAt', 'asc'\)\.select\(\)\.get\(\)/);
  });
});
