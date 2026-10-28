import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { ProviderDiagnosticStore, DIAGNOSTIC_REVIEW_PATH } from './providerDiagnosticStore';
const now = Date.parse('2026-10-28T13:00:00Z');
const key = '11111111-1111-4111-8111-111111111111';
const key2 = '22222222-2222-4222-8222-222222222222';
const root = 'free_chat_chain/provider_diagnostics';
function fixture() {
  const rate = { model: 'test-model', contextTokens: 4096, inputPerMillionNanoUsd: 1_000_000, outputPerMillionNanoUsd: 2_000_000, rateEvidenceRef: 'review:tariff' };
  const docs = new Map<string, any>([
    [DIAGNOSTIC_REVIEW_PATH, { version: 1, expiresAt: now + 60_000, priorCommittedPaise: 100_000, priorEvidenceRef: 'review:prior-api-and-sandbox', totalBudgetPaise: 200_000, allInPaisePerUsdCeiling: 10_000, monthlyCapNanoUsd: 10e9, providers: { surplus: rate, cheaperinference: rate } }],
    ['free_chat_chain/paid_budget_policy', { kind: 'paid_budget_policy', version: 1, revision: 1, capNanoUsd: 10e9, updatedAt: now, source: 'admin' }],
    ['live_ai_registry/old_connection_test', { status: 'completed', latencyMs: 1234 }],
  ]);
  const evidence = { version: 1, status: 'verified', reviewId: 'test-review', artifactSha256: 'a'.repeat(64), reviewedAt: now, expiresAt: now + 90000 };
  docs.set(`${root}/evidence/review:prior-api-and-sandbox`, { ...evidence, kind: 'benchmark-reconciliation', includesApiAndSandbox: true, includesUnresolvedLiabilities: true, committedPaise: 100000, otherBenchmarkUpperBoundPaise: 0, concurrentLiabilityBoundThrough: now + 90000, coversAllOutstandingAuthorizedBenchmarkSpend: true, coversAllOtherBenchmarkDispatch: true, allInPaisePerUsdCeiling: 10000, conversionIncludesFeesAndTaxes: true });
  for (const provider of ['surplus', 'cheaperinference']) {
    const rate = { ...docs.get(DIAGNOSTIC_REVIEW_PATH).providers[provider], rateEvidenceRef: `tariff:${provider}` };
    docs.get(DIAGNOSTIC_REVIEW_PATH).providers[provider] = rate;
    docs.set(`${root}/evidence/tariff:${provider}`, { ...evidence, ...rate, kind: 'supplier-tariff', provider, credentialsPinnedToDeploymentRevision: true, deploymentRevision: 'test-deployment', endpoint: provider === 'surplus' ? 'https://api.surplusintelligence.ai/v1' : 'https://api.cheaperinference.com/v1', ratesLockedForAdmittedRequest: true, ratesAreAllDimensionCeilings: true, coversAllServedModelVersions: true, accountSpecific: true, accountReviewId: 'test-account-review', currency: 'USD', billingBasis: 'tokens-only', additionalCharges: 'none', outputCapIncludesReasoning: true, sourceUrl: provider === 'surplus' ? 'https://api.surplusintelligence.ai/pricing' : 'https://api.cheaperinference.com/pricing' });
  }
  let serial = Promise.resolve(); let uncertain = false;
  const snapshot = (path: string) => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) });
  const db = {
    doc: (path: string) => ({ path, get: async () => snapshot(path) }),
    runTransaction: (callback: any) => {
      const work = serial.then(async () => {
        const writes = new Map<string, any>();
        const result = await callback({ get: async (ref: any) => snapshot(ref.path),
          set: (ref: any, value: any) => writes.set(ref.path, structuredClone(value)),
          create: (ref: any, value: any) => { if (docs.has(ref.path)) throw new Error('exists'); writes.set(ref.path, structuredClone(value)); } });
        for (const [path, value] of writes) docs.set(path, value);
        if (uncertain) { uncertain = false; throw new Error('simulated lost acknowledgement'); }
        return result;
      });
      serial = work.then(() => undefined, () => undefined); return work;
    },
  };
  return { docs, store: new ProviderDiagnosticStore(db as unknown as Firestore, () => now, () => ({ daily: 10e9, monthly: 10e9 }), provider => ({ deploymentRevision: 'test-deployment', endpoint: provider === 'surplus' ? 'https://api.surplusintelligence.ai/v1' : 'https://api.cheaperinference.com/v1' })),
    restart: () => new ProviderDiagnosticStore(db as unknown as Firestore, () => now + 86_400_000, () => ({ daily: 10e9, monthly: 10e9 }), provider => ({ deploymentRevision: 'test-deployment', endpoint: provider === 'surplus' ? 'https://api.surplusintelligence.ai/v1' : 'https://api.cheaperinference.com/v1' })),
    uncertain: () => { uncertain = true; } };
}
describe('durable diagnostic accounting (mock transactions, no provider network)', () => {
  it('allows one concurrent reservation and replays the same run without dispatch', async () => {
    const { store, docs } = fixture();
    const results = await Promise.all([store.reserve(key, 'surplus', 'test-model'), store.reserve(key, 'surplus', 'test-model')]);
    expect(results.map(r => r.mayDispatch)).toEqual([true, false]);
    expect(results[0].run.runId).toBe(results[1].run.runId);
    expect(docs.get('free_chat_chain/paid_day_2026-10-28').requests).toBe(1);
    expect(docs.get('live_ai_registry/old_connection_test')).toEqual({ status: 'completed', latencyMs: 1234 });
  });
  it('uses a global slot across both providers and rejects changing provider under a replay key', async () => {
    const { store } = fixture(); await store.reserve(key, 'surplus', 'test-model');
    await expect(store.reserve(key2, 'cheaperinference', 'test-model')).rejects.toMatchObject({ reason: 'run_in_progress' });
    await expect(store.reserve(key, 'cheaperinference', 'test-model')).rejects.toMatchObject({ reason: 'invalid_request' });
  });
  it.each(['surplus', 'cheaperinference'] as const)('binds %s to its reviewed model', async provider => {
    const { store } = fixture();
    await expect(store.reserve(key, provider, 'another-model')).rejects.toMatchObject({ reason: 'budget_evidence_unavailable' });
    expect((await store.reserve(key, provider, 'test-model')).run.provider).toBe(provider);
  });
  it('uncertain committed reservation cannot dispatch after reconnect or restart', async () => {
    const f = fixture(); f.uncertain();
    await expect(f.store.reserve(key, 'surplus', 'test-model')).rejects.toThrow('lost acknowledgement');
    const replay = await f.restart().reserve(key, 'surplus', 'test-model');
    expect(replay.mayDispatch).toBe(false); expect(replay.run.actualCostNanoUsd).toBeNull();
  });
  it('unknown cost retains daily, monthly and aggregate holds without expiry', async () => {
    const f = fixture(); const { run } = await f.store.reserve(key, 'surplus', 'test-model');
    const result = await f.store.finish(key, run.runId, null);
    expect(result).toMatchObject({ state: 'unknown_liability', actualCostNanoUsd: null });
    expect(f.docs.get('free_chat_chain/paid_day_2026-10-28').heldNanoUsd).toBe(run.reservedNanoUsd);
    expect(f.docs.get('free_chat_chain/state/paid_month/2026-10').heldNanoUsd).toBe(run.reservedNanoUsd);
    expect(f.docs.get(`${root}/ledger/total`).activeRunId).toBe(run.runId);
    expect((await f.restart().reserve(key, 'surplus', 'test-model')).mayDispatch).toBe(false);
    expect(JSON.stringify(result)).not.toContain('expiresAt');
  });
  it('settles an evidenced cost atomically and idempotently, preserving history', async () => {
    const f = fixture(); const { run } = await f.store.reserve(key, 'surplus', 'test-model');
    await f.store.finish(key, run.runId, 1000); const snapshot = JSON.stringify([...f.docs]);
    await f.store.finish(key, run.runId, 1000); expect(JSON.stringify([...f.docs])).toBe(snapshot);
    expect(f.docs.get('free_chat_chain/paid_day_2026-10-28')).toMatchObject({ spentNanoUsd: 1000, heldNanoUsd: 0, pending: 0 });
    expect((await f.store.reserve(key2, 'cheaperinference', 'test-model')).mayDispatch).toBe(true);
    expect((await f.store.read(key))?.state).toBe('settled');
    expect((await f.store.reserve(key, 'surplus', 'test-model')).mayDispatch).toBe(false);
  });
  it('uncertain settlement acknowledgement cannot double-settle', async () => {
    const f = fixture(); const { run } = await f.store.reserve(key, 'surplus', 'test-model'); f.uncertain();
    await expect(f.store.finish(key, run.runId, 1000)).rejects.toThrow('lost acknowledgement');
    await f.store.finish(key, run.runId, 1000);
    expect(f.docs.get('free_chat_chain/state/paid_month/2026-10').spentNanoUsd).toBe(1000);
  });
  it.each(['review', 'prior', 'expired', 'policy', 'daily', 'monthly', 'per-test', 'aggregate'])('blocks missing or insufficient %s evidence', async mode => {
    const f = fixture(); const review = f.docs.get(DIAGNOSTIC_REVIEW_PATH);
    if (mode === 'review') f.docs.delete(DIAGNOSTIC_REVIEW_PATH);
    if (mode === 'prior') review.priorCommittedPaise = null;
    if (mode === 'expired') review.expiresAt = now;
    if (mode === 'policy') f.docs.delete('free_chat_chain/paid_budget_policy');
    if (mode === 'daily') f.docs.get('free_chat_chain/paid_budget_policy').capNanoUsd = 0;
    if (mode === 'monthly') review.monthlyCapNanoUsd = 1;
    if (mode === 'per-test') review.providers.surplus.inputPerMillionNanoUsd = 1e12;
    if (mode === 'aggregate') review.priorCommittedPaise = 200_000;
    await expect(f.store.reserve(key, 'surplus', 'test-model')).rejects.toThrow();
    expect(await f.store.read(key)).toBeNull();
  });
  it('does not refund other existing daily/monthly holds or a prior liability floor', async () => {
    const f = fixture(); const { run } = await f.store.reserve(key, 'surplus', 'test-model');
    const day = f.docs.get('free_chat_chain/paid_day_2026-10-28'); day.heldNanoUsd += 77; day.pending++; day.requests++;
    f.docs.get('free_chat_chain/state/paid_month/2026-10').heldNanoUsd += 77;
    await f.store.finish(key, run.runId, 1000);
    f.docs.get(DIAGNOSTIC_REVIEW_PATH).priorCommittedPaise = 0;
    f.docs.get(`${root}/evidence/review:prior-api-and-sandbox`).committedPaise = 0;
    await f.store.reserve(key2, 'cheaperinference', 'test-model');
    expect(f.docs.get(`${root}/ledger/total`).priorCommittedPaise).toBe(100_000);
    expect(day.heldNanoUsd).toBeGreaterThan(77);
    expect(f.docs.get('free_chat_chain/state/paid_month/2026-10').heldNanoUsd).toBe(77 + run.reservedNanoUsd);
  });
  it('fails closed when an initialized aggregate ledger disappears', async () => {
    const f = fixture(); const { run } = await f.store.reserve(key, 'surplus', 'test-model');
    await f.store.finish(key, run.runId, 1000);
    f.docs.delete(`${root}/ledger/total`);
    await expect(f.store.reserve(key2, 'surplus', 'test-model')).rejects.toMatchObject({ reason: 'accounting_failed' });
  });
  it('records an overrun honestly and keeps the global stop', async () => {
    const f = fixture(); const { run } = await f.store.reserve(key, 'surplus', 'test-model');
    const actual = run.reservedNanoUsd + 10;
    await f.store.finish(key, run.runId, actual);
    expect(f.docs.get('free_chat_chain/paid_day_2026-10-28').spentNanoUsd).toBe(actual);
    await expect(f.store.reserve(key2, 'surplus', 'test-model')).rejects.toMatchObject({ reason: 'run_in_progress' });
  });
  it('does not persist or emit prompts, outputs, credentials or raw errors', async () => {
    const f = fixture(); const logger = vi.spyOn(console, 'log'); const error = vi.spyOn(console, 'error');
    try {
      const { run } = await f.store.reserve(key, 'surplus', 'test-model');
      f.docs.get(`${root}/runs/${key}`).secret = 'sensitive-marker';
      expect(JSON.stringify(await f.store.read(key))).not.toContain('sensitive-marker');
      await f.store.finish(key, run.runId, null);
      expect(JSON.stringify(f.docs.get(`${root}/runs/${key}`))).not.toContain('sensitive-marker');
      expect(logger).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    } finally { logger.mockRestore(); error.mockRestore(); }
  });
});

describe('shared status and transactional evidence admission', () => {
  it('reads valid evidence without writes and agrees with admission', async () => {
    const f = fixture(); const before = JSON.stringify([...f.docs]);
    expect(await f.store.status('surplus', 'test-model')).toMatchObject({ dispatchReady: true, missingFields: [] });
    expect(JSON.stringify([...f.docs])).toBe(before);
    expect((await f.store.reserve(key, 'surplus', 'test-model')).mayDispatch).toBe(true);
    expect(await f.store.status('cheaperinference', 'test-model')).toMatchObject({ dispatchReady: false, reason: 'run_in_progress' });
  });
  it.each(['missing', 'example-url', 'account', 'amount', 'expired', 'reasoning'])('blocks invalid %s tariff evidence with precise fields', async mode => {
    const f = fixture(); const path = `${root}/evidence/tariff:surplus`; const tariff = f.docs.get(path);
    const field = mode === 'missing' ? 'tariff.verifiedRecord' : mode === 'example-url' ? 'tariff.officialSource' : mode === 'account' ? 'tariff.accountReviewId' : mode === 'amount' ? 'tariff.inputPerMillionNanoUsd' : mode === 'expired' ? 'tariff.reviewWindow' : 'tariff.chargeDimensions';
    if (mode === 'missing') f.docs.delete(path);
    if (mode === 'example-url') tariff.sourceUrl = 'https://official-provider.example/pricing';
    if (mode === 'account') tariff.accountSpecific = false;
    if (mode === 'amount') tariff.inputPerMillionNanoUsd++;
    if (mode === 'expired') tariff.expiresAt = now;
    if (mode === 'reasoning') tariff.outputCapIncludesReasoning = false;
    const status = await f.store.status('surplus', 'test-model'); expect(status.dispatchReady).toBe(false); expect(status.missingFields).toContain(field);
    await expect(f.store.reserve(key, 'surplus', 'test-model')).rejects.toMatchObject({ fields: expect.arrayContaining([field]) });
    expect(await f.store.read(key)).toBeNull();
  });
  it('rechecks evidence changed after status before dispatch', async () => {
    const f = fixture(); expect((await f.store.status('surplus', 'test-model')).dispatchReady).toBe(true);
    f.docs.get(`${root}/evidence/review:prior-api-and-sandbox`).includesUnresolvedLiabilities = false;
    await expect(f.store.reserve(key, 'surplus', 'test-model')).rejects.toMatchObject({ fields: expect.arrayContaining(['reconciliation.scope']) });
  });
});
