import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  createQubaxSelector, getQubaxSelection, QUBAX_CATALOG_PATH, QUBAX_EVIDENCE_TTL_MS,
  QUBAX_QUALITY_POLICY, selectQubaxCandidate,
  type QubaxCatalog, type QubaxCatalogCandidate, type QubaxWorkload,
} from '../src/server/lib/qubaxSelector';

const NOW = 1_800_000_000_000;
const workload: QubaxWorkload = { inputTokens: 1_000, outputTokens: 1_000, language: 'hi' };
function fixture(at = NOW): QubaxCatalog {
  const evidence = { observedAtMs: at - 1_000, expiresAtMs: at + 299_000, evidenceRef: 'reviewed-source:fixture-only' };
  const scope = { model: 'fixture-text', revision: 'fixture-revision-1', sku: 'text-standard', tokenizer: 'fixture-tokenizer-1',
    contextBand: 'under-8k', serviceTier: 'standard', currency: 'USD' as const, billingBasis: 'per-million-tokens' as const, modality: 'text' as const };
  const common = { ...evidence, scope, cacheReadNanoUsdPerMillionTokens: null, cacheWriteNanoUsdPerMillionTokens: null,
    requestFeeNanoUsd: 0, additionalFeesNanoUsd: 0, minimumChargeNanoUsd: 0, allFeesIncluded: true as const, reviewRef: 'independent-price-review' };
  return { ...evidence, kind: 'qubax-reviewed-chat-catalog-v1', benchmarkRef: 'reviewed-chat-eval-fixture-v1',
    independentReviewRef: 'trusted-operator-review', candidates: [{ modelId: 'fixture-dispatch-id', maxInputTokens: 8_000, maxOutputTokens: 4_000,
      qubax: { ...common, source: 'qubax', inputNanoUsdPerMillionTokens: 100_000_000, outputNanoUsdPerMillionTokens: 100_000_000 },
      official: { ...common, scope: { ...scope }, source: 'official', inputNanoUsdPerMillionTokens: 1_000_000_000, outputNanoUsdPerMillionTokens: 1_000_000_000 },
      supplierContract: { ...evidence, reviewRef: 'reviewed-supplier-contract', hardCeilingEnforced: true,
        exactModelAndRevisionEnforced: true, includesInternalRetriesFailoversAndFees: true, perHttpRequestCeilingNanoUsd: 200_000 },
      quality: { policyId: QUBAX_QUALITY_POLICY.id, benchmarkRef: 'reviewed-chat-eval-fixture-v1', reviewRef: 'reviewed-hindi-chat-evaluation',
        reviewedAtMs: at - 60_000, expiresAtMs: at + 3_600_000, textScoreBps: 8_500, hindiScoreBps: 8_500,
        successRateBps: 9_950, p95LatencyMs: 1_000, sampleCount: 200, approved: true },
    }] };
}
const select = (catalog: unknown = fixture(), request = workload, now = NOW) => selectQubaxCandidate(catalog, request, now);

describe('Qubax reviewed Chat selection', () => {
  it('selects a fully reviewed exact-workload 90% discount, exposing only immutable dispatch evidence', () => {
    expect(select()).toMatchObject({ modelId: 'fixture-dispatch-id', modelRevision: 'fixture-revision-1', sku: 'text-standard',
      maximumNanoUsd: 200_000, qubaxCostNanoUsd: 200_000, officialCostNanoUsd: 2_000_000, discountBps: 9_000,
      expiresAtMs: NOW + 299_000, reviewRef: 'trusted-operator-review', evidenceBinding: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(Object.isFrozen(select())).toBe(true);
  });

  it.each([null, undefined, {}, [], 'marketing discount 99%', { kind: 'qubax-reviewed-chat-catalog-v1' }])('skips absent or malformed evidence: %j', value => {
    expect(selectQubaxCandidate(value, workload, NOW)).toBeNull();
  });
  it.each(['inputTokens', 'outputTokens'] as const)('rejects invalid %s', key => {
    for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(select(fixture(), { ...workload, [key]: value })).toBeNull();
  });
  it('supports Hindi and English text only and rejects unknown workload/capabilities', () => {
    expect(select(fixture(), { ...workload, language: 'en' })).not.toBeNull();
    expect(select(fixture(), { inputTokens: 1_000, outputTokens: 1_000 })).not.toBeNull();
    expect(select(fixture(), { ...workload, language: 'other' })).toBeNull();
    expect(select(fixture(), { ...workload, capability: 'vision' as 'text' })).toBeNull();
    expect(select(fixture(), { ...workload, inputTokens: 8_001 })).toBeNull();
    expect(select(fixture(), { ...workload, outputTokens: 4_001 })).toBeNull();
  });
  it.each(['model', 'revision', 'sku', 'tokenizer', 'contextBand', 'serviceTier', 'currency', 'billingBasis', 'modality'] as const)('rejects non-equivalent official %s', key => {
    const catalog = fixture();
    (catalog.candidates[0].official.scope as unknown as Record<string, string>)[key] = 'different';
    expect(select(catalog)).toBeNull();
  });
  it('rejects unknown or floating revisions even when both quotes repeat them', () => {
    for (const revision of ['unknown', 'latest', 'auto', '*', 'n/a']) {
      const c = fixture(); c.candidates[0].qubax.scope.revision = revision; c.candidates[0].official.scope.revision = revision;
      expect(select(c)).toBeNull();
    }
  });
  it.each(['catalog', 'qubax', 'official', 'supplierContract'] as const)('independently expires %s evidence, even after a recent document read', key => {
    for (const kind of ['stale', 'future', 'overlong', 'missing-ref'] as const) {
      const c = fixture();
      const e = key === 'catalog' ? c : c.candidates[0][key];
      if (kind === 'stale') { e.observedAtMs = NOW - 300_000; e.expiresAtMs = NOW; }
      if (kind === 'future') e.observedAtMs = NOW + 1;
      if (kind === 'overlong') e.expiresAtMs = e.observedAtMs + 300_001;
      if (kind === 'missing-ref') e.evidenceRef = '';
      expect(select(c)).toBeNull();
    }
  });
  it('requires independent source reviews, all fees, and known cache assumptions', () => {
    const edits: ((c: QubaxCatalog) => void)[] = [
      c => { c.independentReviewRef = ''; }, c => { c.candidates[0].qubax.reviewRef = ''; },
      c => { c.candidates[0].official.reviewRef = ''; }, c => { c.candidates[0].official.source = 'qubax'; },
      c => { (c.candidates[0].qubax as any).allFeesIncluded = false; },
      c => { delete (c.candidates[0].official as any).cacheReadNanoUsdPerMillionTokens; },
      c => { delete (c.candidates[0].qubax as any).cacheWriteNanoUsdPerMillionTokens; },
    ];
    for (const edit of edits) { const c = fixture(); edit(c); expect(select(c)).toBeNull(); }
  });
  it('does not infer a supplier ceiling or model pinning from cheap prices', () => {
    for (const field of ['hardCeilingEnforced', 'includesInternalRetriesFailoversAndFees', 'exactModelAndRevisionEnforced', 'reviewRef', 'perHttpRequestCeilingNanoUsd']) {
      const c = fixture(); delete (c.candidates[0].supplierContract as any)[field]; expect(select(c)).toBeNull();
    }
    const c = fixture(); c.candidates[0].supplierContract.perHttpRequestCeilingNanoUsd = 199_999; expect(select(c)).toBeNull();
  });
  it('rejects a cap even one nanodollar above a 90% discount, without float rounding', () => {
    const c = fixture(); c.candidates[0].supplierContract.perHttpRequestCeilingNanoUsd += 1;
    expect(select(c)).toBeNull();
  });
  it('counts Qubax fixed fees and minimum charges rather than marketing token prices', () => {
    for (const field of ['requestFeeNanoUsd', 'additionalFeesNanoUsd', 'minimumChargeNanoUsd'] as const) {
      const c = fixture(); c.candidates[0].qubax[field] = 1;
      expect(select(c)).toBeNull();
    }
  });
  it('uses cheapest official cached input and worst Qubax cache-write cost', () => {
    const cached = fixture(); cached.candidates[0].official.cacheReadNanoUsdPerMillionTokens = 10_000_000;
    expect(select(cached)).toBeNull();
    const writes = fixture(); writes.candidates[0].qubax.cacheWriteNanoUsdPerMillionTokens = 1;
    expect(select(writes)).toBeNull();
  });
  it('rejects one expensive token direction even when the total can look cheap', () => {
    const c = fixture(); c.candidates[0].qubax.inputNanoUsdPerMillionTokens = 200_000_000;
    c.candidates[0].qubax.outputNanoUsdPerMillionTokens = 0;
    expect(select(c)).toBeNull();
  });
  it('does conservative integer rounding and rejects zero or overflowing official denominators', () => {
    const c = fixture(); c.candidates[0].qubax.inputNanoUsdPerMillionTokens = 1;
    c.candidates[0].qubax.outputNanoUsdPerMillionTokens = 1;
    c.candidates[0].official.inputNanoUsdPerMillionTokens = 10;
    c.candidates[0].official.outputNanoUsdPerMillionTokens = 10;
    c.candidates[0].supplierContract.perHttpRequestCeilingNanoUsd = 1;
    expect(select(c, { inputTokens: 1, outputTokens: 1 })).toBeNull();
    const overflow = fixture(); overflow.candidates[0].maxInputTokens = Number.MAX_SAFE_INTEGER;
    expect(select(overflow, { ...workload, inputTokens: Number.MAX_SAFE_INTEGER })).toBeNull();
  });
  it.each(['textScoreBps', 'hindiScoreBps', 'successRateBps', 'p95LatencyMs', 'sampleCount', 'policyId', 'benchmarkRef', 'reviewRef', 'expiresAtMs', 'reviewedAtMs', 'approved'] as const)('requires current reviewed quality, reliability and latency: %s', field => {
    const c = fixture();
    const bad = { textScoreBps: 7_999, hindiScoreBps: 7_999, successRateBps: 9_899, p95LatencyMs: 10_001, sampleCount: 99,
      policyId: 'unreviewed', benchmarkRef: 'different-suite', reviewRef: '', expiresAtMs: NOW, reviewedAtMs: NOW + 1, approved: false };
    (c.candidates[0].quality as any)[field] = bad[field];
    expect(select(c)).toBeNull();
  });
  it('ranks reviewed task quality before reliability, latency and cost', () => {
    const c = fixture();
    const first = c.candidates[0];
    const second: QubaxCatalogCandidate = structuredClone(first); second.modelId = 'better-text';
    second.quality.textScoreBps = 9_000; second.quality.hindiScoreBps = 9_000;
    first.supplierContract.perHttpRequestCeilingNanoUsd = 100_000;
    first.qubax.inputNanoUsdPerMillionTokens = first.qubax.outputNanoUsdPerMillionTokens = 50_000_000;
    c.candidates.push(second);
    expect(select(c)?.modelId).toBe('better-text');
    first.quality = { ...second.quality, successRateBps: 9_999 };
    expect(select(c)?.modelId).toBe(first.modelId);
    first.quality = { ...second.quality, p95LatencyMs: 900 };
    expect(select(c)?.modelId).toBe(first.modelId);
    first.quality = { ...second.quality };
    expect(select(c)?.modelId).toBe(first.modelId);
  });
  it('rejects duplicate dispatch aliases rather than guessing their model revisions', () => {
    const c = fixture(); c.candidates.push(structuredClone(c.candidates[0]));
    expect(select(c)).toBeNull();
  });
  it('binds all selected evidence and workload, not unstable property insertion order', () => {
    const c = fixture(); const before = select(c)!;
    c.candidates[0].qubax.reviewRef = 'new-review';
    expect(select(c)?.evidenceBinding).not.toBe(before.evidenceBinding);
    expect(select(c, { ...workload, language: 'en' })?.evidenceBinding).not.toBe(select(c)?.evidenceBinding);
    const reordered = Object.fromEntries(Object.entries(c).reverse());
    expect(select(reordered)?.evidenceBinding).toBe(select(c)?.evidenceBinding);
    expect(select(c, workload, NOW + 1)?.evidenceBinding).toBe(select(c)?.evidenceBinding);
  });
});

describe('read-only catalog refresh', () => {
  it('caches reads for at most five minutes and single-flights concurrent callers', async () => {
    let now = NOW; const read = vi.fn(async () => fixture(now)); const selector = createQubaxSelector(read, () => now);
    const results = await Promise.all([selector(workload), selector(workload), selector(workload)]);
    expect(results.every(Boolean)).toBe(true); expect(read).toHaveBeenCalledTimes(1);
    now += 299_000; expect(await selector(workload)).toBeNull(); expect(read).toHaveBeenCalledTimes(1);
    now += 1_000; expect(await selector(workload)).not.toBeNull(); expect(read).toHaveBeenCalledTimes(2);
  });
  it('cannot turn stale sources fresh by re-reading the document', async () => {
    let now = NOW; const stale = fixture(); const read = vi.fn(async () => stale); const selector = createQubaxSelector(read, () => now);
    expect(await selector(workload)).not.toBeNull(); now += QUBAX_EVIDENCE_TTL_MS;
    expect(await selector(workload)).toBeNull(); expect(read).toHaveBeenCalledTimes(2);
  });
  it('rechecks wall clock after slow catalog reads', async () => {
    let now = NOW; const selector = createQubaxSelector(async () => { now += 300_000; return fixture(); }, () => now);
    expect(await selector(workload)).toBeNull();
  });
  it('fails closed on read errors and does not reuse a previously eligible snapshot', async () => {
    let now = NOW; const read = vi.fn().mockResolvedValueOnce(fixture()).mockRejectedValue(new Error('unavailable'));
    const selector = createQubaxSelector(read, () => now);
    expect(await selector(workload)).not.toBeNull(); now += 300_000;
    expect(await selector(workload)).toBeNull(); expect(await selector(workload)).toBeNull();
  });
  it('snapshots the read value and supports forced dispatch revocation checks', async () => {
    const c = fixture(); const read = vi.fn(async () => c); const selector = createQubaxSelector(read, () => NOW);
    expect(await selector(workload)).not.toBeNull(); c.candidates = [];
    expect(await selector(workload)).not.toBeNull();
    expect(await selector(workload, true)).toBeNull(); expect(read).toHaveBeenCalledTimes(2);
  });
  it('reads the server-owned path, supports force refresh, and isolates databases', async () => {
    const c = fixture(); const get = vi.fn(async () => ({ data: () => c }));
    const doc = vi.fn(() => ({ get })); const db = { doc } as unknown as Firestore;
    expect(await getQubaxSelection(db, workload, NOW)).not.toBeNull();
    expect(await getQubaxSelection(db, workload, NOW)).not.toBeNull();
    expect(doc).toHaveBeenCalledWith(QUBAX_CATALOG_PATH); expect(get).toHaveBeenCalledTimes(1);
    c.candidates = []; expect(await getQubaxSelection(db, workload, NOW, true)).toBeNull(); expect(get).toHaveBeenCalledTimes(2);
    expect(await getQubaxSelection({ doc } as unknown as Firestore, workload, NOW)).toBeNull(); expect(get).toHaveBeenCalledTimes(3);
  });
  it('snapshots workloads before an asynchronous catalog read', async () => {
    let resolve!: (value: unknown) => void;
    const reader = new Promise<unknown>(done => { resolve = done; });
    const selector = createQubaxSelector(() => reader, () => NOW);
    const request = { ...workload }; const pending = selector(request);
    request.inputTokens = 9_000; resolve(fixture());
    expect(await pending).not.toBeNull();
  });
  it('forces a new read after an earlier in-flight read when checking revocation', async () => {
    let resolve!: (value: unknown) => void;
    const initial = new Promise<unknown>(done => { resolve = done; });
    const read = vi.fn().mockReturnValueOnce(initial).mockResolvedValue({ ...fixture(), candidates: [] });
    const selector = createQubaxSelector(read, () => NOW);
    const first = selector(workload); const forced = selector(workload, true);
    resolve(fixture()); await first; expect(await forced).toBeNull(); expect(read).toHaveBeenCalledTimes(2);
  });
  it('refreshes after a backwards clock jump instead of extending the cache lifetime', async () => {
    let now = NOW; const read = vi.fn(async () => fixture(now)); const selector = createQubaxSelector(read, () => now);
    await selector(workload); now -= 1; expect(await selector(workload)).not.toBeNull(); expect(read).toHaveBeenCalledTimes(2);
  });
});
