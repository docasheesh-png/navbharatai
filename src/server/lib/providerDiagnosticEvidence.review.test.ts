import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_EVIDENCE_ROOT, readDiagnosticEvidence } from './providerDiagnosticEvidence';

const now = Date.parse('2026-10-28T13:00:00Z');
function fixture() {
  const rate = { model: 'reviewed-model', contextTokens: 4096, inputPerMillionNanoUsd: 1000000,
    outputPerMillionNanoUsd: 2000000, rateEvidenceRef: 'reviewed-tariff' };
  const review = { version: 1, expiresAt: now + 60000, priorCommittedPaise: 120000, priorEvidenceRef: 'reviewed-reconciliation',
    totalBudgetPaise: 200000, allInPaisePerUsdCeiling: 10000, monthlyCapNanoUsd: 1000000000,
    providers: { surplus: rate, cheaperinference: rate } };
  const common = { version: 1, status: 'verified', reviewId: 'real-review-reference', artifactSha256: 'a'.repeat(64), reviewedAt: now - 1000, expiresAt: now + 90000 };
  const prior: Record<string, unknown> = { ...common, kind: 'benchmark-reconciliation', includesApiAndSandbox: true,
    includesUnresolvedLiabilities: true, committedPaise: 100000, otherBenchmarkUpperBoundPaise: 20000,
    concurrentLiabilityBoundThrough: now + 90000, coversAllOutstandingAuthorizedBenchmarkSpend: true, coversAllOtherBenchmarkDispatch: true,
    allInPaisePerUsdCeiling: 10000, conversionIncludesFeesAndTaxes: true };
  const tariff: Record<string, unknown> = { ...common, ...rate, kind: 'supplier-tariff', provider: 'surplus',
    deploymentRevision: 'reviewed-revision', endpoint: 'https://api.surplusintelligence.ai/v1',
    credentialsPinnedToDeploymentRevision: true, ratesLockedForAdmittedRequest: true, ratesAreAllDimensionCeilings: true, coversAllServedModelVersions: true,
    accountSpecific: true, accountReviewId: 'reviewed-account', currency: 'USD', billingBasis: 'tokens-only',
    additionalCharges: 'none', outputCapIncludesReasoning: true, sourceUrl: 'https://api.surplusintelligence.ai/pricing' };
  const binding = { deploymentRevision: 'reviewed-revision', endpoint: 'https://api.surplusintelligence.ai/v1' };
  const read = async (path: string) => path === `${DIAGNOSTIC_EVIDENCE_ROOT}/reviewed-reconciliation` ? prior : tariff;
  return { review, prior, tariff, binding, run: () => readDiagnosticEvidence(review, 'surplus', 'reviewed-model', now, read, binding) };
}
describe('independent diagnostic evidence review regressions', () => {
  it('accepts a complete reviewed binding while preserving concurrent spend in the total', async () => {
    const f = fixture(); expect((await f.run()).priorCommittedPaise).toBe(120000);
  });
  it.each(['deploymentRevision', 'endpoint'] as const)('rejects changed configured %s', async field => {
    const f = fixture(); f.binding[field] = field === 'endpoint' ? 'https://api.surplusintelligence.ai/min90/v1' : 'new-revision';
    await expect(f.run()).rejects.toMatchObject({ fields: expect.arrayContaining(['tariff.deploymentAccountBinding']) });
  });
  it('rejects absent deployment identity without deriving a credential hash', async () => {
    const f = fixture(); f.binding.deploymentRevision = '';
    await expect(f.run()).rejects.toMatchObject({ fields: expect.arrayContaining(['tariff.deploymentAccountBinding']) });
  });
  it.each(['ratesAreAllDimensionCeilings', 'coversAllServedModelVersions'])('rejects missing %s coverage', async field => {
    const f = fixture(); delete f.tariff[field];
    await expect(f.run()).rejects.toMatchObject({ fields: expect.arrayContaining(['tariff.allDimensionCeilings']) });
  });
  it('rejects reasoning outside the output reservation', async () => {
    const f = fixture(); f.tariff.outputCapIncludesReasoning = false;
    await expect(f.run()).rejects.toMatchObject({ fields: expect.arrayContaining(['tariff.chargeDimensions']) });
  });
  it('rejects a concurrent-spend upper bound omitted from aggregate liability', async () => {
    const f = fixture(); f.review.priorCommittedPaise = 100000;
    await expect(f.run()).rejects.toMatchObject({ fields: expect.arrayContaining(['reconciliation.committedPaise']) });
  });
  it.each(['coversAllOtherBenchmarkDispatch', 'concurrentLiabilityBoundThrough'])('rejects insufficient concurrent coverage %s', async field => {
    const f = fixture(); f.prior[field] = field === 'coversAllOtherBenchmarkDispatch' ? false : now + 89999;
    await expect(f.run()).rejects.toMatchObject({ fields: expect.arrayContaining(['reconciliation.concurrentLiabilityBound']) });
  });
  it.each(['https://official-provider.example/pricing', 'https://api.surplusintelligence.ai.evil.test/pricing', 'https://user:secret@api.surplusintelligence.ai/pricing'])('rejects nonofficial or credential-bearing source %# without echoing it', async source => {
    const f = fixture(); f.tariff.sourceUrl = source;
    await expect(f.run()).rejects.toMatchObject({ fields: expect.arrayContaining(['tariff.officialSource']) });
    await f.run().catch(error => expect(JSON.stringify(error)).not.toContain(source));
  });
  it('rejects credentials not pinned to the reviewed deployment revision', async () => {
    const f = fixture(); f.tariff.credentialsPinnedToDeploymentRevision = false;
    await expect(f.run()).rejects.toMatchObject({ fields: expect.arrayContaining(['tariff.deploymentAccountBinding']) });
  });
  it.each(['tariff', 'reconciliation'] as const)('requires %s evidence through the full admitted deadline', async kind => {
    const f = fixture(); (kind === 'tariff' ? f.tariff : f.prior).expiresAt = f.review.expiresAt + 29999;
    await expect(f.run()).rejects.toMatchObject({ fields: expect.arrayContaining([`${kind}.reviewWindow`]) });
  });
  it('rejects expired review at the exact boundary', async () => {
    const f = fixture(); f.review.expiresAt = now;
    await expect(f.run()).rejects.toMatchObject({ fields: expect.arrayContaining(['review.expiresAt']) });
  });
});
