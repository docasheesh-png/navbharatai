// DB-14 / DB-17 (go-live audit 2026-10-13): a durable wallet_ops record makes a repeated purchase or a
// late build-charge retry a replay instead of a second charge.
import { describe, it, expect } from 'vitest';
import { purchaseHostingPlan } from '../src/server/lib/hostingPlan';
import { debitWalletForBuild } from '../src/server/lib/walletDebit';
import { HOSTING_TIERS } from '../src/lib/hostingTiers';
import { TOKENS_PER_RUPEE } from '../src/server/lib/payments';
import { WALLET_OPS, validRequestId, walletOpId } from '../src/server/lib/walletOps';

const STARTER = HOSTING_TIERS[0];
const PRICE = STARTER.priceInr * TOKENS_PER_RUPEE;
const NOW = '2026-08-06T12:00:00.000Z';
const wallet = (tokens: number, extra: Record<string, any> = {}) => ({
  userId: 'u1', tokenBalance: tokens, totalTokensUsed: 0, remaining_balance: tokens / TOKENS_PER_RUPEE,
  walletLedger: [], giftTokensRemaining: 0, total_money_spent: tokens / TOKENS_PER_RUPEE, ...extra,
});
function fakeDb(docs: Record<string, any>) {
  return {
    doc: (path: string) => path,
    runTransaction: async (fn: any) => fn({
      get: async (ref: string) => ({ exists: !!docs[ref], data: () => docs[ref], id: ref, ref }),
      set: (ref: string, value: any) => { docs[ref] = value; },
      update: (ref: string, value: any) => { docs[ref] = { ...docs[ref], ...value }; },
      delete: (ref: string) => { delete docs[ref]; },
    }),
  } as any;
}

describe('walletOps helpers', () => {
  it('ids are stable, kind-scoped and path-safe', () => {
    expect(walletOpId('u1', 'plan', 'r1')).toBe(walletOpId('u1', 'plan', 'r1'));
    expect(walletOpId('u1', 'plan', 'r1')).not.toBe(walletOpId('u1', 'build', 'r1'));
    expect(walletOpId('u1', 'plan', 'a/b')).toMatch(/^plan_[0-9a-f]{40}$/);
  });
  it('request ids are validated', () => {
    expect(validRequestId('hp_abc12345')).toBe(true);
    for (const v of ['short', 'has space 123', 'x'.repeat(81), 42, null]) expect(validRequestId(v)).toBe(false);
  });
});

describe('DB-14: the same purchase request twice charges once', () => {
  it('replays with the same requestId', async () => {
    const docs: Record<string, any> = { 'user_token_wallets/u1': wallet(3 * PRICE) };
    const db = fakeDb(docs);
    const opts = { agreedToTerms: true, requestId: 'hp_req_000001' };
    const a = await purchaseHostingPlan(db, 'u1', NOW, STARTER.id, opts);
    const b = await purchaseHostingPlan(db, 'u1', NOW, STARTER.id, opts);
    if (!a.ok || !b.ok) throw new Error('purchase failed');
    expect(b.charged).toBe(false);
    expect(b.tokenBalance).toBe(a.tokenBalance);
    expect(docs[`${WALLET_OPS}/${walletOpId('u1', 'plan', 'hp_req_000001')}`]).toBeTruthy();
  });
  it('a different requestId is a new purchase (old behaviour kept)', async () => {
    const docs: Record<string, any> = { 'user_token_wallets/u1': wallet(3 * PRICE) };
    const db = fakeDb(docs);
    const a = await purchaseHostingPlan(db, 'u1', NOW, STARTER.id, { agreedToTerms: true, requestId: 'hp_req_000001' });
    const b = await purchaseHostingPlan(db, 'u1', NOW, STARTER.id, { agreedToTerms: true, requestId: 'hp_req_000002' });
    if (!a.ok || !b.ok) throw new Error('purchase failed');
    expect(b.tokenBalance).toBe(a.tokenBalance - PRICE);
  });
  it('a refused purchase writes no op record', async () => {
    const docs: Record<string, any> = { 'user_token_wallets/u1': wallet(0) };
    const r = await purchaseHostingPlan(fakeDb(docs), 'u1', NOW, STARTER.id, { agreedToTerms: true, requestId: 'hp_req_000003' });
    expect(r.ok).toBe(false);
    expect(Object.keys(docs).some((k) => k.startsWith(WALLET_OPS))).toBe(false);
  });
});

describe('DB-17: a build charge older than the 500-row ledger is still a replay', () => {
  it('second debit with the same buildRef charges nothing even after the ledger forgot it', async () => {
    const docs: Record<string, any> = { 'user_token_wallets/u1': wallet(10_000 * TOKENS_PER_RUPEE) };
    const db = fakeDb(docs);
    const tx = { billedInr: 5, buildRef: 'build_old_1', description: 'build' } as any;
    const first = await debitWalletForBuild(db, 'u1', tx);
    expect(first.ok && first.tokensDebited).toBeGreaterThan(0);
    docs['user_token_wallets/u1'].walletLedger = []; // the 500-row cap rolled past it
    const again = await debitWalletForBuild(db, 'u1', tx);
    expect(again.ok).toBe(true);
    expect(again.tokensDebited).toBe(0);
    expect(again.tokenBalance).toBe(first.tokenBalance);
  });
});
