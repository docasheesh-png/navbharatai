import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ docs: new Map<string, any>(), writes: [] as string[] }));
vi.mock('../src/server/lib/serverDb', async (original) => ({
  ...(await original<typeof import('../src/server/lib/serverDb')>()),
  doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
  runTransaction: async (_db: unknown, fn: (tx: any) => Promise<any>) => {
    const pending: Array<[string, any]> = [];
    const result = await fn({
      get: async ({ path }: { path: string }) => ({ exists: () => state.docs.has(path), data: () => structuredClone(state.docs.get(path)) }),
      update: ({ path }: { path: string }, value: any) => pending.push([path, { ...state.docs.get(path), ...value }]),
      set: ({ path }: { path: string }, value: any) => pending.push([path, value]),
    });
    for (const [path, value] of pending) { state.docs.set(path, value); state.writes.push(path); }
    return result;
  },
}));
import { adjustAdminBuildTokens } from '../src/server/lib/adminTokenAdjustment';
import { maskWalletForView } from '../src/server/lib/freeProgram';
import { computeDebitedWallet } from '../src/server/lib/walletDebit';
import { setFreeProgramPausedHint } from '../src/server/lib/freeProgramHint';
const NOW = '2026-10-26T00:00:00.000Z';
const input = { userId: 'test-owner', delta: 100_000, reason: 'Synthetic app-building grant', requestId: 'request-test-0001' };
const empty = () => ({ tokenBalance: 0, remaining_balance: 0, totalMoneySpent: 0, giftTokensRemaining: 0, walletLedger: [] });
const prior = process.env.WALLET_MERGE_RESOLVE;
beforeEach(() => { state.docs.clear(); state.writes = []; state.docs.set('user_token_wallets/test-owner', empty()); process.env.WALLET_MERGE_RESOLVE = 'on'; });
afterEach(() => { if (prior === undefined) delete process.env.WALLET_MERGE_RESOLVE; else process.env.WALLET_MERGE_RESOLVE = prior; setFreeProgramPausedHint(null); });
describe('admin grant → canonical persisted wallet → projection → app debit', () => {
  it('moves both views and provenance atomically, then the real build debit spends the credit', async () => {
    setFreeProgramPausedHint(true);
    const r = await adjustAdminBuildTokens({}, input, NOW);
    expect(r?.newBalance).toBe(100_000);
    const stored = state.docs.get('user_token_wallets/test-owner');
    expect(stored.totalMoneySpent).toBe(0);
    expect(maskWalletForView(stored, true).tokenBalance).toBe(100_000);
    expect(stored.walletLedger[0].adminBuildTokensDelta).toBe(100_000);
    const used = computeDebitedWallet(stored, { feature: 'build', adminCreditEligible: true, billedInr: 10, buildRef: 'synthetic-build', description: 'App building' }, NOW);
    expect(used.wallet.tokenBalance).toBe(99_000);
    expect(used.wallet.adminBuildTokensRemaining).toBe(99_000);
    expect(state.writes).toHaveLength(2);
  });
  it('replayed request is a durable no-op even when the ledger has rolled off', async () => {
    await adjustAdminBuildTokens({}, input, NOW);
    state.docs.get('user_token_wallets/test-owner').walletLedger = [];
    const count = state.writes.length;
    expect((await adjustAdminBuildTokens({}, input, NOW))?.replayed).toBe(true);
    expect(state.writes).toHaveLength(count);
    expect(state.docs.get('user_token_wallets/test-owner').tokenBalance).toBe(100_000);
  });
  it('the same request cannot change target, amount, or reason', async () => {
    await adjustAdminBuildTokens({}, input, NOW);
    for (const change of [{ delta: 200_000 }, { userId: 'other-test-owner' }, { reason: 'Different reason' }]) {
      await expect(adjustAdminBuildTokens({}, { ...input, ...change }, NOW)).rejects.toThrow('different adjustment');
    }
    expect(state.writes).toHaveLength(2);
  });
  it('follows canonical identity in-transaction, never credits the retired wallet', async () => {
    state.docs.set('user_token_wallets/test-owner', { ...empty(), mergedInto: 'canonical-owner' });
    state.docs.set('user_token_wallets/canonical-owner', empty());
    const r = await adjustAdminBuildTokens({}, input, NOW);
    expect(r?.walletId).toBe('canonical-owner');
    expect(state.docs.get('user_token_wallets/test-owner').tokenBalance).toBe(0);
    expect(state.docs.get('user_token_wallets/canonical-owner').tokenBalance).toBe(100_000);
    // Owner can move again without invalidating request identity or minting another credit.
    state.docs.get('user_token_wallets/test-owner').mergedInto = 'another-owner';
    expect((await adjustAdminBuildTokens({}, input, NOW))?.replayed).toBe(true);
    expect(state.writes).toHaveLength(2);
  });
  it('refuses unresolved identities, absent wallets, and legacy requests without a stable ID', async () => {
    await expect(adjustAdminBuildTokens({}, { ...input, requestId: '' }, NOW)).rejects.toThrow('request ID');
    state.docs.get('user_token_wallets/test-owner').mergedInto = 'test-owner';
    await expect(adjustAdminBuildTokens({}, input, NOW)).rejects.toThrow('safely');
    state.docs.delete('user_token_wallets/test-owner');
    expect(await adjustAdminBuildTokens({}, input, NOW)).toBeNull();
    expect(state.writes).toEqual([]);
  });
  it('refuses first provenance activation during a legacy hold without writing wallet or dedupe record', async () => {
    const w = { ...empty(), tokenBalance: 1, remaining_balance: 0.01,
      walletLedger: [{ type: 'usage', rollupRef: 'legacy', amountCoinsOrTokens: 0,
        openHolds: [{ id: 'legacy-half', owed: 0.5, gift: 0 }] }] };
    state.docs.set('user_token_wallets/test-owner', w);
    await expect(adjustAdminBuildTokens({}, input, NOW)).rejects.toThrow('No credit was added');
    expect(state.writes).toEqual([]);
    expect(state.docs.get('user_token_wallets/test-owner')).toBe(w);
  });
  it('a deduction records the applied delta, not the requested amount past zero', async () => {
    state.docs.set('user_token_wallets/test-owner', { ...empty(), tokenBalance: 100, remaining_balance: 1, giftTokensRemaining: 100, adminBuildTokensRemaining: 100 });
    await adjustAdminBuildTokens({}, { ...input, delta: -500 }, NOW);
    const w = state.docs.get('user_token_wallets/test-owner');
    expect(w.tokenBalance).toBe(0);
    expect(w.walletLedger[0].amountCoinsOrTokens).toBe(-100);
    expect(w.walletLedger[0].adminBuildTokensDelta).toBe(-100);
  });
});
