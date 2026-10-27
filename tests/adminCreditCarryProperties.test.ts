import { afterEach, describe, expect, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = vi.hoisted(() => ({ docs: new Map<string, Record<string, any>>(), writes: [] as string[] }));
vi.mock('../src/server/lib/serverDb', async (original) => ({
  ...(await original<typeof import('../src/server/lib/serverDb')>()),
  doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
  runTransaction: async (_db: unknown, fn: (tx: any) => Promise<any>) => fn({
    get: async ({ path }: { path: string }) => ({ exists: () => store.docs.has(path), data: () => structuredClone(store.docs.get(path)) }),
    // Record attempted writes too: refusal must precede every write, not merely rely on rollback.
    update: ({ path }: { path: string }) => { store.writes.push(path); },
    set: ({ path }: { path: string }) => { store.writes.push(path); },
  }),
}));
import { adjustAdminBuildTokens } from '../src/server/lib/adminTokenAdjustment';
import { mergeWallets } from '../src/server/lib/accountMerge';
import { adminBuildRemaining, giftRemaining, paidSpendableTokens } from '../src/server/lib/giftSpend';
import { mirroredCreditPatch } from '../src/server/lib/walletMirror';
import { computeClawedBackWallet } from '../src/server/lib/paymentReversal';
import { materializeWalletCharge, walletCarries, type CarryPurpose } from '../src/server/lib/walletCarry';
import { computeDebitedWallet, computeRolledUpDebit, computeRolledUpRelease, type WalletDebitTx } from '../src/server/lib/walletDebit';
import { setFreeProgramPausedHint } from '../src/server/lib/freeProgramHint';

const NOW = '2026-10-26T00:00:00.000Z';
const priorWelcome = process.env.WELCOME_BONUS_TOKENS;
afterEach(() => {
  setFreeProgramPausedHint(null);
  if (priorWelcome === undefined) delete process.env.WELCOME_BONUS_TOKENS;
  else process.env.WELCOME_BONUS_TOKENS = priorWelcome;
});

describe('independent accounting properties for explicit admin credit', () => {
  it('conserves every source liability under 2,160 purpose, capacity and merged-carry combinations', () => {
    let cases = 0;
    const purposes: CarryPurpose[] = ['cash', 'ordinary', 'admin'];
    for (const purpose of purposes) for (const cash of [0, 0.75, 1.5, 10.2])
      for (const ordinary of [0, 0.75, 1.5]) for (const admin of [0, 0.75, 1.5])
        for (const amount of [0.1, 0.5, 0.75, 1, 3]) for (const capacity of [0, 1, 2, 100]) {
          const w = { cashRequiredTokenCarry: cash, ordinaryGiftTokenCarry: ordinary, adminEligibleTokenCarry: admin };
          const result = materializeWalletCharge(w, amount, purpose, capacity);
          const next = walletCarries(result.patch);
          assert.ok(Math.abs(next.cash + next.ordinary + next.admin + result.tokens - (cash + ordinary + admin + amount)) < 1e-5);
          assert.ok(result.tokens >= 0 && result.tokens <= capacity);
          for (const other of purposes) if (other !== purpose) assert.equal(next[other], walletCarries(w)[other]);
          cases++;
        }
    expect(cases).toBe(2160);
  });

  it('cash and Weak half-token charges remain separate in either order', () => {
    setFreeProgramPausedHint(true);
    const start = { tokenBalance: 101, remaining_balance: 1.01, giftTokensRemaining: 100, adminBuildTokensRemaining: 100, totalMoneySpent: 0.01, walletLedger: [] };
    const cash: WalletDebitTx = { feature: 'hosting-plan', spends: 'paid-only', billedInr: 0.005, description: 'Paid purchase', buildRef: 'paid' };
    const weak: WalletDebitTx = { feature: 'build', adminCreditEligible: true, billedInr: 0.005, description: 'Weak build', buildRef: 'weak' };
    for (const order of [[cash, weak], [weak, cash]]) {
      let w: Record<string, any> = start;
      for (const tx of order) w = computeDebitedWallet(w, tx, NOW).wallet;
      expect(w.tokenBalance).toBe(101);
      expect(w.adminBuildTokensRemaining).toBe(100);
      expect(walletCarries(w)).toEqual({ cash: 0.5, ordinary: 0, admin: 0.5 });
    }
  });

  it('an integer hold and release leave all merged carry buckets untouched', () => {
    setFreeProgramPausedHint(true);
    const start = { tokenBalance: 200, remaining_balance: 2, giftTokensRemaining: 100, adminBuildTokensRemaining: 100,
      totalMoneySpent: 1, walletLedger: [], cashRequiredTokenCarry: 1.5, ordinaryGiftTokenCarry: 0.7, adminEligibleTokenCarry: 0.8, tokenCarry: 3 };
    const held = computeRolledUpDebit(start, { feature: 'image', billedInr: 0.01, rollupRef: 'images', holdId: 'whole-token-hold', description: 'Image', floorInr: 0, allOrNothing: true }, NOW);
    expect(held.tokensDebited).toBe(1);
    const released = computeRolledUpRelease(held.wallet, { rollupRef: 'images', holdId: 'whole-token-hold', description: 'Image' }, NOW);
    expect(released.tokensReturned).toBe(1);
    expect(released.wallet.tokenBalance).toBe(start.tokenBalance);
    expect(released.wallet.adminBuildTokensRemaining).toBe(start.adminBuildTokensRemaining);
    expect(walletCarries(released.wallet)).toEqual(walletCarries(start));
  });

  it('preserves 0.75 + 0.75 merged debt and later materializes it without discarding its tail', () => {
    setFreeProgramPausedHint(true);
    const w = { tokenBalance: 100, remaining_balance: 1, giftTokensRemaining: 0, adminBuildTokensRemaining: 0,
      totalMoneySpent: 1, walletLedger: [], cashRequiredTokenCarry: 0.75, ordinaryGiftTokenCarry: 0, adminEligibleTokenCarry: 0, tokenCarry: 0.75 };
    const merged = mergeWallets(w, w, NOW).wallet;
    expect(walletCarries(merged).cash).toBe(1.5);
    const charged = computeDebitedWallet(merged, { feature: 'hosting-plan', spends: 'paid-only', billedInr: 0.01, buildRef: 'after-merge', description: 'Paid purchase' }, NOW);
    expect(charged.tokensDebited).toBe(2);
    expect(walletCarries(charged.wallet).cash).toBe(0.5);
    expect(charged.wallet.tokenBalance).toBe(198);
  });

  it('matches the historical merge formula on 1,600 internally consistent legacy pairs', () => {
    process.env.WELCOME_BONUS_TOKENS = '50000';
    const wallets: Record<string, any>[] = [];
    for (const welcome of [0, 50000]) for (const purchased of [0, 100, 10000, 60000]) for (const used of [0, 50, 10000, 50000, 150000]) {
      const balance = welcome + purchased - used;
      wallets.push({ tokenBalance: balance, remaining_balance: balance / 100, totalTokensPurchased: welcome + purchased,
        totalTokensUsed: used, totalMoneySpent: purchased / 100, giftTokensRemaining: Math.max(0, Math.min(balance, welcome - used)),
        walletLedger: welcome ? [{ description: 'Welcome Bonus', amountCoinsOrTokens: welcome }] : [] });
    }
    let cases = 0;
    for (const a of wallets) for (const b of wallets) {
      assert.equal(mergeWallets({ ...a, adminBuildTokensRemaining: 0 }, b, NOW).wallet.tokenBalance, mergeWallets(a, b, NOW).wallet.tokenBalance);
      cases++;
    }
    expect(cases).toBe(1600);
  });

  it('preserves partitions without minting paid or admin value across 26,569 tracked merge pairs', () => {
    setFreeProgramPausedHint(true);
    const wallets: Record<string, any>[] = [];
    for (const paid of [0, 100, 1000]) for (const ordinary of [0, 100, 1000]) for (const admin of [0, 100, 1000]) for (const use of [0, 50, 1500]) {
      let w: Record<string, any> = { tokenBalance: paid + ordinary, remaining_balance: (paid + ordinary) / 100,
        totalTokensPurchased: paid, totalMoneySpent: paid / 100, giftTokensRemaining: ordinary, walletLedger: [] };
      w = { ...w, ...mirroredCreditPatch(w, admin, 'admin-build') };
      if (use) w = computeDebitedWallet(w, { feature: 'build', adminCreditEligible: true, billedInr: use / 100, buildRef: 'used', description: 'Weak build' }, NOW).wallet;
      wallets.push(w);
      wallets.push(computeClawedBackWallet(w, { tokens: 70, reversedInr: 0.7, kind: 'refund', reversalRef: 'refund' }, NOW).wallet);
    }
    wallets.push({ tokenBalance: -200, remaining_balance: -2, totalMoneySpent: 0, totalTokensUsed: 200, giftTokensRemaining: 0, adminBuildTokensRemaining: 0, walletLedger: [] });
    let cases = 0;
    for (const a of wallets) for (const b of wallets) {
      const before = JSON.stringify([a, b]);
      const merged = mergeWallets(a, b, NOW).wallet;
      assert.equal(merged.tokenBalance, a.tokenBalance + b.tokenBalance);
      assert.ok(adminBuildRemaining(merged) <= giftRemaining(merged));
      assert.ok(giftRemaining(merged) <= Math.max(0, merged.tokenBalance));
      assert.ok(adminBuildRemaining(merged) <= adminBuildRemaining(a) + adminBuildRemaining(b));
      assert.ok(paidSpendableTokens(merged) <= paidSpendableTokens(a) + paidSpendableTokens(b));
      assert.equal(JSON.stringify([a, b]), before);
      cases++;
    }
    expect(cases).toBe(26569);
  });

  it('transactionally refuses first grant activation before any write when a legacy hold remains', async () => {
    store.docs.clear(); store.writes = [];
    const wallet = { tokenBalance: 99, remaining_balance: 0.99, giftTokensRemaining: 99,
      walletLedger: [{ openHolds: [{ id: 'legacy-hold', owed: 0.5, gift: 0 }] }] };
    store.docs.set('user_token_wallets/synthetic-owner', wallet);
    await expect(adjustAdminBuildTokens({}, { userId: 'synthetic-owner', delta: 100, reason: 'Synthetic credit', requestId: 'synthetic-request-0001' }, NOW)).rejects.toThrow(/pending wallet reservations/);
    expect(store.writes).toEqual([]);
    expect(store.docs.get('user_token_wallets/synthetic-owner')).toEqual(wallet);
  });

  it('both real build settlement lanes derive entitlement only from server-resolved Weak', () => {
    const source = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const assignments = source.match(/adminCreditEligible:\s*[^,\n]+/g) ?? [];
    expect(assignments).toEqual([
      "adminCreditEligible: powerLevelReqEffective === 'weak'",
      "adminCreditEligible: powerLevelReqEffective === 'weak'",
    ]);
    expect(source).toContain("readWalletBalanceInr(async () => walletDoc, userId, powerLevelReqEffective === 'weak' ? 'build' : 'usage')");
  });
});
