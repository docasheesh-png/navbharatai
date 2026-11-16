/** DNA (05011–05013): Surplus scope ask showed provider=unknown, 0 tokens on every Weak build even after
 * #4015 (tokens) and #4016 (adapted params). A response-path failure records provider=SURPLUS; only a
 * throw BEFORE any response gives provider=unknown. The live owner pilot shares ONE global Firestore
 * pilot doc whose single pendingCallId / permanent blocked flag jammed after the first uncertain call,
 * so every reservation threw before HTTP. These tests drive the real adapter + session + receipt store. */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getServerDb: vi.fn(), refresh: vi.fn(), read: vi.fn(), transport: vi.fn(), factory: vi.fn() }));
vi.mock('../../lib/serverDb', () => ({ getServerDb: mocks.getServerDb }));
vi.mock('./runtime', async importOriginal => ({ ...await importOriginal<typeof import('./runtime')>(), refreshSurplusRegistry: mocks.refresh }));
vi.mock('./store', async importOriginal => ({ ...await importOriginal<typeof import('./store')>(), SurplusStore: class { read = mocks.read; } }));
vi.mock('./transport', () => ({ createSurplusBuildTransport: mocks.factory }));
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: vi.fn(async () => {}), aiMaintenanceStore: { onChange: () => () => {} }, AiMaintenanceError: class extends Error {} }));
import { createHash } from 'node:crypto';
import { createSurplusBuildSession } from './buildSession';
import { createProductionSurplusAdapter } from './productionAdapter';
import { createSurplusScopeAsk } from './scopeAdmission';
import { admitWeakBuild } from '../../AgentV3/weakBuildAdmission';
import { reserveSurplusAttempt, persistSurplusReceipt, SURPLUS_LIVE_PILOT_ID } from './receiptStore';

const KEY = 'sk-live-test-key';
const env = { AGENTV3_SURPLUS_BUILDER: 'true', SURPLUS_API_KEY: KEY, SURPLUS_REGISTRY_MODELS: 'gpt-5.6-sol,deepseek-v4.1-flash' };
const digest = (parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const credSha = createHash('sha256').update(KEY).digest('hex');
const livePilotPath = `surplus_pilot_admissions/${digest(['surplus-live-key', credSha, SURPLUS_LIVE_PILOT_ID])}`;
/** Exactly what production held after the first uncertain 05011 call. */
const JAMMED = { calls: 3, actualMicroUsd: '0', pendingCallId: 'stale-call-from-05011', reservedEstimatedMicroUsd: '1234',
  expiresAt: Date.now() + 1e9, authorityId: SURPLUS_LIVE_PILOT_ID, blocked: true, quarantineReason: 'supplier_cost_unknown', quarantinedAt: 1 };

function fakeDb(seed: Record<string, unknown> = {}) {
  const docs = new Map<string, any>(Object.entries(seed).map(([k, v]) => [k, structuredClone(v)]));
  let queue = Promise.resolve();
  const ref = (path: string) => ({ path, get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }) });
  const db = { docs, doc: ref, runTransaction: (fn: (tx: any) => Promise<any>) => {
    const run = queue.then(async () => { const writes = new Map<string, any>();
      const result = await fn({ get: async (r: { path: string }) => ({ exists: docs.has(r.path), data: () => structuredClone(docs.get(r.path)) }), set: (r: { path: string }, v: unknown) => writes.set(r.path, structuredClone(v)) });
      for (const [k, v] of writes) docs.set(k, v); return result; });
    queue = run.catch(() => {}) as Promise<void>; return run;
  } };
  return db;
}
function offer(model: string, providerId: string) {
  const now = Date.now();
  return { model, offerId: 'o-' + model, providerId, available: true, healthy: true, trusted: true, providerTrustConfirmed: true, trustObservedAt: now,
    discountPct: 98.4, rates: { input: '64000', output: '320000' }, referenceRates: { input: '4000000', output: '20000000' }, unit: 'unverified', observedAt: now,
    upstreamGeneratedAt: null, sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30, sourceUrl: 'https://api.surplusintelligence.ai/api/markets/' + model };
}
function wire(req: any, cost: number | undefined = 3) {
  return { status: 200, receivedAt: Date.now(), headers: { 'x-si-provider-family': req.provider, 'x-si-served-by': 'marketplace', 'x-si-adapted-params': 'max_tokens' },
    body: { id: 'r-' + Math.random(), model: req.model, choices: [{ message: { role: 'assistant', content: 'simple' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 300, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 0 }, ...(cost === undefined ? {} : { buyer_cost_micro: cost }) } } };
}
async function scopeOnce() {
  const session = (await createSurplusBuildSession({ buildId: 'b-' + Math.random(), tier: 'weak', enabled: true, adapter: createProductionSurplusAdapter(env) }))!;
  const records: any[] = [];
  const result = await admitWeakBuild('Make a page that only says Hello SurplusTest05013 in big text.', createSurplusScopeAsk(session, [], records)!);
  return { session, result, records };
}
beforeEach(() => {
  vi.resetAllMocks();
  const now = Date.now();
  mocks.read.mockResolvedValue({ version: 'gen', startedAt: now, observedAt: now, expiresAt: now + 300000, models: ['gpt-5.6-sol', 'deepseek-v4.1-flash'],
    offers: [offer('gpt-5.6-sol', 'openai'), offer('deepseek-v4.1-flash', 'deepseek')] });
  mocks.refresh.mockResolvedValue(undefined);
  mocks.factory.mockReturnValue(mocks.transport);
  mocks.transport.mockImplementation(async (req: any) => wire(req));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Surplus live pilot — the scope ask is no longer killed by a jammed global pilot doc', () => {
  it('05013 repro: a jammed live pilot doc no longer blocks; gpt-5.6-sol answers the scope ask on Surplus', async () => {
    const db = fakeDb({ [livePilotPath]: JAMMED });
    mocks.getServerDb.mockReturnValue(db);
    const { session, result, records } = await scopeOnce();
    expect(session.model).toBe('deepseek-v4.1-flash');
    expect(result).toMatchObject({ scope: 'simple', source: 'model' });
    expect(records).toEqual([expect.objectContaining({ ok: true, provider: 'SURPLUS', model: 'deepseek-v4.1-flash' })]);
    expect(mocks.transport).toHaveBeenCalledTimes(1);
    // 2026-11-16: a live call never reads or writes the shared pilot doc, so the jammed doc is simply ignored.
    expect(db.docs.get(livePilotPath)).toEqual(JAMMED);
  });

  it('an uncertain live call (transport died after reservation) never blocks the NEXT build; its receipt stays pending for audit', async () => {
    const db = fakeDb();
    mocks.getServerDb.mockReturnValue(db);
    mocks.transport.mockImplementationOnce(async () => { throw new Error('socket hang up'); });
    const first = await scopeOnce();
    expect(first.result.scope).toBeNull();
    expect(first.records[0]).toMatchObject({ ok: false, provider: 'unknown', error: 'Build scope classification failed (stage=dispatch reason=dispatch_failed)' });
    const receipts = [...db.docs.entries()].filter(([k]) => k.startsWith('surplus_build_receipts/')).map(([, v]) => v);
    expect(receipts.map(r => r.state)).toEqual(['pending']); // the uncertain call's own liability is retained
    const second = await scopeOnce(); // before this fix: "Surplus pilot pending, blocked or exhausted"
    expect(second.result).toMatchObject({ scope: 'simple', source: 'model' });
    expect(second.records[0]).toMatchObject({ ok: true, provider: 'SURPLUS', model: 'deepseek-v4.1-flash' });
  });

  it('concurrent live builds both reserve (no global single-flight), replay of one callId still refused', async () => {
    const db = fakeDb();
    const pilot = { id: SURPLUS_LIVE_PILOT_ID, expiresAt: Date.now() + 1e9, maxCalls: 1_000_000, maxEstimatedMicroUsd: '999999999999999999', providerSpendLimitReviewedUntil: Date.now() + 1e9, noAutoTopup: true as const };
    const input = { buildId: 'a', callId: 'c1', accountId: 'surplus-live-key', credentialSha256: credSha, model: 'gpt-5.6-sol', providerId: 'openai', endpoint: 'min90', policyVersion: 'p', priceGeneration: 'g', estimatedMicroUsd: '30', reviewRevision: 1, pilot, now: Date.now() };
    const both = await Promise.allSettled([reserveSurplusAttempt(db as never, input), reserveSurplusAttempt(db as never, { ...input, buildId: 'b', callId: 'c2' })]);
    expect(both.map(r => r.status)).toEqual(['fulfilled', 'fulfilled']);
    await expect(reserveSurplusAttempt(db as never, input)).rejects.toThrow('already reserved');
    const res = await persistSurplusReceipt(db as never, { buildId: 'a', callId: 'c1', accountId: 'surplus-live-key', model: 'gpt-5.6-sol', providerId: 'openai', endpoint: 'min90', policyVersion: 'p', priceGeneration: 'g', reportedAt: Date.now(), usage: null, invoiceReconciliation: 'not-reconciled',
      decision: { actualCostUsd: '0.00002', officialCeilingUsd: '0.0002', userChargeUsd: '0', evidenceFingerprint: 'f', status: 'absorbed' } as never });
    expect(res.canContinue).toBe(true);
  });

  it('reviewed (non-live) pilots keep the strict single-flight lock', async () => {
    const db = fakeDb();
    const pilot = { id: 'reviewed-pilot', expiresAt: Date.now() + 1e9, maxCalls: 10, maxEstimatedMicroUsd: '1000', providerSpendLimitReviewedUntil: Date.now() + 1e9, noAutoTopup: true as const };
    const input = { buildId: 'a', callId: 'c1', accountId: 'acct', credentialSha256: credSha, model: 'm', providerId: 'p', endpoint: 'min90', policyVersion: 'p', priceGeneration: 'g', estimatedMicroUsd: '30', reviewRevision: 1, pilot, now: Date.now() };
    await reserveSurplusAttempt(db as never, input);
    await expect(reserveSurplusAttempt(db as never, { ...input, callId: 'c2' })).rejects.toThrow('pending');
  });

  it('a pre-HTTP failure is now named in the report row (stage=reservation), not a bare provider=unknown', async () => {
    const db = fakeDb();
    mocks.getServerDb.mockReturnValue({ ...db, runTransaction: async () => { throw new Error('PRIVATE firestore detail'); } });
    const { result, records } = await scopeOnce();
    expect(result.failure).toEqual({ stage: 'reservation', reason: 'reservation_failed' });
    expect(records[0]).toMatchObject({ ok: false, provider: 'unknown', error: 'Build scope classification failed (stage=reservation reason=reservation_failed)' });
    expect(JSON.stringify(records)).not.toContain('PRIVATE');
    expect(mocks.transport).not.toHaveBeenCalled();
  });

  // Owner 2026-11-16 ("100+ calls ek saath"): the shared live-pilot doc was a Firestore hotspot — every call
  // read and rewrote it twice. Firestore sustains ~1 write/s on one document, so it serialized Surplus at scale.
  describe('100+ concurrent live calls never touch the shared pilot document', () => {
    const livePilot = () => ({ id: SURPLUS_LIVE_PILOT_ID, expiresAt: Date.now() + 1e9, maxCalls: 1_000_000, maxEstimatedMicroUsd: '999999999999999999', providerSpendLimitReviewedUntil: Date.now() + 1e9, noAutoTopup: true as const });
    const base = (callId: string) => ({ buildId: 'b-' + callId, callId, accountId: 'surplus-live-key', credentialSha256: credSha, model: 'gpt-5.6-sol', providerId: 'openai', endpoint: 'min90', policyVersion: 'p', priceGeneration: 'g' });
    const decision = (cost: string | null) => ({ actualCostUsd: cost, officialCeilingUsd: '0.0002', userChargeUsd: '0', evidenceFingerprint: 'f', status: 'absorbed' } as never);
    function trackedDb(seed: Record<string, unknown> = {}) {
      const db = fakeDb(seed); const touched: string[] = [];
      const run = db.runTransaction;
      db.runTransaction = (fn: (tx: any) => Promise<any>) => run(async (tx: any) => fn({
        get: (r: { path: string }) => { touched.push('get ' + r.path); return tx.get(r); },
        set: (r: { path: string }, v: unknown) => { touched.push('set ' + r.path); return tx.set(r, v); },
      }));
      return { db, touched };
    }

    it('150 concurrent reservations + settlements: all succeed, pilot doc never read or written', async () => {
      const { db, touched } = trackedDb();
      const ids = Array.from({ length: 150 }, (_, i) => 'call-' + i);
      const reserved = await Promise.allSettled(ids.map(id => reserveSurplusAttempt(db as never, { ...base(id), estimatedMicroUsd: '30', reviewRevision: 1, pilot: livePilot(), now: Date.now() })));
      expect(reserved.filter(r => r.status === 'rejected')).toEqual([]);
      const settled = await Promise.all(ids.map(id => persistSurplusReceipt(db as never, { ...base(id), reportedAt: Date.now(), usage: null, invoiceReconciliation: 'not-reconciled', decision: decision('0.00002') })));
      expect(settled.every(r => r.canContinue)).toBe(true);
      expect(touched.filter(t => t.includes('surplus_pilot_admissions/'))).toEqual([]);
      const receipts = [...db.docs.entries()].filter(([k]) => k.startsWith('surplus_build_receipts/')).map(([, v]) => v);
      expect(receipts).toHaveLength(150);
      expect(receipts.every(r => r.state === 'reported' && r.authorityId === SURPLUS_LIVE_PILOT_ID)).toBe(true);
    });

    it('the old 1,000,000-call cap no longer switches the live pilot off for good', async () => {
      const { db } = trackedDb({ [livePilotPath]: { ...JAMMED, calls: 1_000_000, blocked: false, quarantineReason: null, quarantinedAt: null, pendingCallId: null } });
      await expect(reserveSurplusAttempt(db as never, { ...base('after-cap'), estimatedMicroUsd: '30', reviewRevision: 1, pilot: livePilot(), now: Date.now() })).resolves.toBeUndefined();
    });

    it('a live receipt still refuses replay, keeps an unknown cost as unknown, and allows only the absorb correction', async () => {
      const { db } = trackedDb();
      await reserveSurplusAttempt(db as never, { ...base('u1'), estimatedMicroUsd: '30', reviewRevision: 1, pilot: livePilot(), now: Date.now() });
      await expect(reserveSurplusAttempt(db as never, { ...base('u1'), estimatedMicroUsd: '30', reviewRevision: 1, pilot: livePilot(), now: Date.now() })).rejects.toThrow('already reserved');
      const audit = { ...base('u1'), reportedAt: Date.now(), usage: null, invoiceReconciliation: 'not-reconciled' as const, decision: decision(null) };
      expect((await persistSurplusReceipt(db as never, audit)).canContinue).toBe(false);
      const receipt = [...db.docs.entries()].find(([k]) => k.startsWith('surplus_build_receipts/'))![1];
      expect(receipt).toMatchObject({ state: 'unknown', quarantineReason: 'supplier_cost_unknown' });
      expect((await persistSurplusReceipt(db as never, audit)).canContinue).toBe(false); // identical replay is idempotent
      await expect(persistSurplusReceipt(db as never, { ...audit, decision: { ...(decision('0.5') as object), evidenceFingerprint: 'other' } as never })).rejects.toThrow('audit conflict');
    });

    it('a live receipt reserved BEFORE this change (no authorityId) still settles through the pilot doc', async () => {
      const pilotDoc = { calls: 1, actualMicroUsd: '0', pendingCallId: null, reservedEstimatedMicroUsd: '0', expiresAt: Date.now() + 1e9, authorityId: SURPLUS_LIVE_PILOT_ID };
      const receiptPath = `surplus_build_receipts/${digest(['surplus-live-key', 'old'])}`;
      const { db } = trackedDb({ [livePilotPath]: pilotDoc, [receiptPath]: { state: 'pending', ...base('old'), pilotKey: digest(['surplus-live-key', credSha, SURPLUS_LIVE_PILOT_ID]), estimatedMicroUsd: '30', reservedAt: Date.now() - 1000, invoiceReconciliation: 'not-reconciled' } });
      const res = await persistSurplusReceipt(db as never, { ...base('old'), reportedAt: Date.now(), usage: null, invoiceReconciliation: 'not-reconciled', decision: decision('0.00002') });
      expect(res.canContinue).toBe(true);
      expect(db.docs.get(livePilotPath)).toMatchObject({ actualMicroUsd: '20' });
      expect(db.docs.get(receiptPath)).toMatchObject({ state: 'reported' });
    });
  });
});
