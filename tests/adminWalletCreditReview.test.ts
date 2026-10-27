import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminWalletCreditReview, readAdminWalletCreditReview } from '../src/server/lib/adminWalletCreditReview';
import { requireAdmin } from '../src/server/lib/adminAuth';

const policy = { paused: true, pauseStateKnown: true, mergeResolutionEnabled: true };
const wallet = () => ({ tokenBalance: 1_200, remaining_balance: 12, giftTokensRemaining: 1_000,
  adminBuildTokensRemaining: 400, totalMoneySpent: 2, walletLedger: [] });

describe('read-only canonical wallet credit review', () => {
  it('distinguishes stored, displayed, Weak and paid values without attributing a historical grant', async () => {
    const w = wallet(); const before = structuredClone(w);
    const r = await readAdminWalletCreditReview(async () => w, 'owner', policy);
    expect(r).toMatchObject({ ok: true, storedTokens: 1200, storedInr: 12, ownerVisibleTokens: 600,
      ownerVisibleInr: 6, weakEligibleTokens: 600, paidSpendableTokens: 200, trackedGiftTokens: 1000,
      trackedAdminTokens: 400, trackedOrdinaryGiftTokens: 600, provenanceConsistent: true });
    expect(r).not.toHaveProperty('historicalGrantRemaining'); expect(w).toEqual(before);
  });
  it('shows a retained legacy balance behind zero projection without guessing gift provenance', async () => {
    const w = { tokenBalance: 25000, remaining_balance: 250, totalMoneySpent: 0,
      walletLedger: [{ type: 'admin_adjustment', amountCoinsOrTokens: 30000, timestamp: '2026-01-01', description: 'Old grant' }] };
    const before = structuredClone(w); const r = await readAdminWalletCreditReview(async () => w, 'owner', policy);
    expect(r).toMatchObject({ storedTokens: 25000, ownerVisibleTokens: 0, ownerVisibleInr: 0,
      trackedGiftTokens: null, trackedAdminTokens: null, trackedOrdinaryGiftTokens: null,
      weakEligibleTokens: 0, paidSpendableTokens: 0, provenanceConsistent: false });
    expect(r.ledgerRows).toMatchObject([{ tokens: 30000, adminTokensDelta: null, requestId: '' }]);
    expect(w).toEqual(before);
  });
  it('partial consumption is current remaining credit, never the old grant sum', async () => {
    const w = { ...wallet(), tokenBalance: 450, remaining_balance: 4.5, giftTokensRemaining: 250,
      adminBuildTokensRemaining: 100, walletLedger: [
        { type: 'admin_adjustment', amountCoinsOrTokens: 1000, adminBuildTokensDelta: 1000, requestId: 'operation-one' },
        { type: 'usage', amountCoinsOrTokens: -900, adminBuildTokensDelta: -900, buildRef: 'weak-build-one' },
      ] };
    const r = await readAdminWalletCreditReview(async () => w, 'owner', policy);
    expect(r.trackedAdminTokens).toBe(100); expect(r.weakEligibleTokens).toBe(300);
    expect(r.paidSpendableTokens).toBe(200); expect(r.trackedOrdinaryGiftTokens).toBe(150);
    expect(r.ledgerRows).toHaveLength(2); expect(r.ledgerRows?.[0].tokens).toBe(1000);
    expect(r.ledgerRows?.[1]).toMatchObject({ tokens: -900, adminTokensDelta: -900, buildRef: 'weak-build-one' });
  });
  it.each([true, false])('merged identities ignore stale source amounts, resolver enabled=%s', async mergeResolutionEnabled => {
    const source = { ...wallet(), tokenBalance: 0, remaining_balance: 0, mergedInto: 'canonical' };
    const target = wallet(); const docs = { source, canonical: target };
    const before = structuredClone(docs); const reads: string[] = [];
    const r = await readAdminWalletCreditReview(async id => { reads.push(id); return docs[id]; }, 'source', { ...policy, mergeResolutionEnabled });
    expect(reads).toEqual(['source', 'canonical']); expect(r.canonicalUserId).toBe('canonical');
    expect(r.identityChain).toEqual(reads); expect(r.storedTokens).toBe(1200);
    expect(r.ownerVisibleTokens).toBe(mergeResolutionEnabled ? 600 : 0); expect(docs).toEqual(before);
  });
  it.each([undefined, -1, 1201, NaN, 0.5])('missing or invalid tracked gifts %s never become a reclassification amount', async giftTokensRemaining => {
    const r = await readAdminWalletCreditReview(async () => ({ ...wallet(), giftTokensRemaining }), 'owner', policy);
    expect(r.provenanceConsistent).toBe(false); expect(r.trackedOrdinaryGiftTokens).toBeNull();
  });
  it('marks pending holds and suspension without writing or offering an automatic action', async () => {
    const w = { ...wallet(), banned: true, walletLedger: [{ openHolds: [{ id: 'hold', owed: 10 }] }] };
    const before = structuredClone(w); const r = await readAdminWalletCreditReview(async () => w, 'owner', policy);
    expect(r).toMatchObject({ pendingReservations: true, suspended: true }); expect(w).toEqual(before);
  });
  it('keeps private fields out and bounds admin evidence; totals never imply complete history', async () => {
    const r = await readAdminWalletCreditReview(async () => ({ ...wallet(), secret: 'must-not-leave',
      walletLedger: Array.from({ length: 70 }, (_, i) => ({ type: 'admin_adjustment', amountCoinsOrTokens: i,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        description: 'x'.repeat(1000), requestId: `request-${i}`, secret: 'must-not-leave' })) }), 'owner', policy);
    expect(r.ledgerRows).toHaveLength(60); expect(r.retainedAdminRows).toBe(70);
    expect(r.ledgerRows?.[0].tokens).toBe(69); expect(r.ledgerRows?.[0].description).toHaveLength(200);
    expect(JSON.stringify(r)).not.toContain('must-not-leave');
  });
  it('finds the newest prepended merged evidence before truncation and never invents dates', async () => {
    const rows = [
      { type: 'admin_adjustment', description: 'Recent merge', timestamp: '2026-10-27T00:00:00Z', amountCoinsOrTokens: 30 },
      { type: 'usage', adminBuildTokensDelta: -10, timestamp: '2026-10-26T00:00:00Z', amountCoinsOrTokens: -10 },
      ...Array.from({ length: 65 }, (_, i) => ({ type: 'admin_adjustment', timestamp: '2026-01-01T00:00:00Z', amountCoinsOrTokens: i })),
      { type: 'admin_adjustment', timestamp: 'not-a-date', amountCoinsOrTokens: 400 },
    ];
    const before = structuredClone(rows);
    const r = await readAdminWalletCreditReview(async () => ({ ...wallet(), walletLedger: rows }), 'owner', policy);
    expect(r.ledgerRows).toHaveLength(60); expect(r.ledgerRows?.[0].description).toBe('Recent merge');
    expect(r.ledgerRows?.[1].adminTokensDelta).toBe(-10); expect(r.retainedUndatedRows).toBe(1);
    expect(r.retainedAdminRows).toBe(68); expect(rows).toEqual(before);
    const unknown = await readAdminWalletCreditReview(async () => ({ ...wallet(), walletLedger: [rows[67]] }), 'owner', policy);
    expect(unknown.ledgerRows?.[0].at).toBe('');
  });
  it.each(['missing', 'throw', 'cycle', 'invalid', 'too-deep'])('unresolved %s never reports a zero canonical balance', async mode => {
    let calls = 0;
    const r = await readAdminWalletCreditReview(async id => {
      calls++;
      if (mode === 'missing') return null;
      if (mode === 'throw') throw new Error('private backend detail');
      return { ...wallet(), mergedInto: mode === 'cycle' ? id : mode === 'invalid' ? 'other/path' : `${id}x` };
    }, 'owner', policy);
    expect(r.ok).toBe(false); expect(r.canonicalUserId).toBeNull(); expect(r).not.toHaveProperty('storedTokens');
    expect(calls).toBeLessThanOrEqual(6); expect(JSON.stringify(r)).not.toContain('private backend detail');
  });
  it('uses one transaction and only reads the stored identity chain', async () => {
    const writes = vi.fn(); const paths: string[] = [];
    const docs = { source: { mergedInto: 'canonical' }, canonical: wallet() };
    const db = { doc: (path: string) => { const [name, id] = path.split('/'); return { name, id }; },
      runTransaction: vi.fn(async fn => fn({ get: async ({ name, id }) => {
        paths.push(`${name}/${id}`); return { exists: !!docs[id], data: () => structuredClone(docs[id]) };
      }, set: writes, update: writes, delete: writes })) };
    const r = await adminWalletCreditReview(db, 'source', policy);
    expect(r.canonicalUserId).toBe('canonical'); expect(db.runTransaction).toHaveBeenCalledOnce();
    expect(paths).toEqual(['user_token_wallets/source', 'user_token_wallets/canonical']); expect(writes).not.toHaveBeenCalled();
  });
  it('a failed transaction is unknown, never a success with invented zeros', async () => {
    const r = await adminWalletCreditReview({ runTransaction: async () => { throw new Error('private'); } }, 'owner', policy);
    expect(r.ok).toBe(false); expect(r).not.toHaveProperty('storedTokens');
  });
  it('the actual account route remains authenticated and logged; ordinary credentials cannot reach the reader', () => {
    const source = readFileSync('src/server/routes/reports.ts', 'utf8');
    const start = source.indexOf("app.get('/api/admin/users/:uid/account', requireAdmin,");
    expect(start).toBeGreaterThan(-1);
    const handler = source.slice(start, source.indexOf("app.post('/api/admin/reports/:id/status'", start));
    expect(handler).toContain("audit('ADMIN_USER_ACCOUNT_VIEW'"); expect(handler).toContain('adminWalletCreditReview(identityDb(), uid,');
    const next = vi.fn(); const json = vi.fn(); const status = vi.fn(() => ({ json }));
    requireAdmin({ headers: { 'x-admin-token': 'ordinary-user' } } as never, { status } as never, next);
    expect(status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
  });
});
