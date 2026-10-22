import { describe, expect, it } from 'vitest';
import { codingEvidenceRank, codingQualityScores, CODING_EVIDENCE_MAX_AGE_MS, type CodingBenchmarkEvidence } from './codingQuality';
const now = 2_000_000_000_000;
const evidence = (patch: Partial<CodingBenchmarkEvidence> = {}): CodingBenchmarkEvidence => ({ task: 'coding', modelId: 'v/model:free', endpointTag: 'endpoint/1', suiteId: 'app-build', suiteVersion: '1', evaluatedAt: now - 1000, sampleCount: 100, passedCount: 95, evidenceReference: 'reviewed-artifact-123', reviewedBy: 'reviewer', reviewedAt: now - 500, ...patch });
const rank = (patch: Partial<CodingBenchmarkEvidence> = {}) => codingEvidenceRank(evidence(patch), 'v/model:free', 'endpoint/1', now);
describe('task-specific coding evidence, independent of free eligibility', () => {
  it('does not invent a score from a model brand, suffix or health', () => {
    expect(codingEvidenceRank(undefined, 'nvidia/nemotron:free', 'endpoint/1', now)).toBeNull();
    expect(codingEvidenceRank({ successRate: 1 }, 'v/model:free', 'endpoint/1', now)).toBeNull();
  });
  it('accepts fresh reviewed evidence with explicit provenance', () => {
    expect(rank()).toMatchObject({ sampleCount: 100, passRate: 0.95, evidenceReference: 'reviewed-artifact-123' });
    expect(rank()!.confidenceLowerBound).toBeGreaterThan(0.88);
  });
  it.each([{ modelId: 'other' }, { endpointTag: 'other' }, { suiteId: '' }, { suiteVersion: '' }, { reviewedBy: '' }, { evidenceReference: '' }, { sampleCount: 4 }, { passedCount: 101 }, { passedCount: -1 }, { sampleCount: Infinity }, { evaluatedAt: now + 1 }, { reviewedAt: now + 1 }, { reviewedAt: now - 2000 }, { evaluatedAt: now - CODING_EVIDENCE_MAX_AGE_MS }])('rejects invalid or stale evidence %j', patch => {
    expect(rank(patch)).toBeNull();
  });
  it('does not rank a tiny perfect sample above extensive strong results', () => {
    const [tiny, strong] = codingQualityScores([rank({ sampleCount: 5, passedCount: 5 }), rank()]);
    expect(strong).toBeGreaterThan(tiny);
  });
  it('gives no quality preference to incomparable suite versions', () => {
    expect(codingQualityScores([rank(), rank({ suiteVersion: '2' }), null])).toEqual([0, 0, 0]);
  });
  it('makes cold-start preference explicit and keeps low pass outcomes out of the bonus', () => {
    const scores = codingQualityScores([rank(), null, rank({ passedCount: 79 })]);
    expect(scores[0]).toBeGreaterThan(1); expect(scores.slice(1)).toEqual([0, 0]);
    expect(codingQualityScores([null, null])).toEqual([0, 0]);
  });
});
