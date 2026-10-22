/**
 * Optional server-reviewed benchmark evidence, not provider marketing or HTTP health.
 * No endpoint is made free/eligible by this metadata. Its only use is ordering already
 * eligible coding candidates. This change creates no benchmark scores or write workflow.
 */
export interface CodingBenchmarkEvidence {
  task: 'coding';
  modelId: string;
  endpointTag: string;
  suiteId: string;
  suiteVersion: string;
  evaluatedAt: number;
  sampleCount: number;
  passedCount: number;
  evidenceReference: string;
  reviewedBy: string;
  reviewedAt: number;
}
export interface CodingEvidenceRank {
  cohortKey: string;
  sampleCount: number;
  passRate: number;
  /** Wilson 95% lower bound reduces the advantage of tiny perfect samples. */
  confidenceLowerBound: number;
  evidenceReference: string;
}
export const CODING_EVIDENCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const CODING_EVIDENCE_MIN_SAMPLES = 5;
export const CODING_EVIDENCE_PREFERENCE_PASS_RATE = 0.8;
const nonempty = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
/** Input must come from trusted server-controlled storage, never a user prompt/catalog field. */
export function codingEvidenceRank(value: unknown, modelId: string, endpointTag: string | null, now: number): CodingEvidenceRank | null {
  if (!value || typeof value !== 'object' || !Number.isFinite(now) || !endpointTag) return null;
  const e = value as Partial<CodingBenchmarkEvidence>;
  if (e.task !== 'coding' || e.modelId !== modelId || e.endpointTag !== endpointTag
    || !nonempty(e.suiteId, 160) || !nonempty(e.suiteVersion, 160)
    || !nonempty(e.evidenceReference, 1024) || !nonempty(e.reviewedBy, 256)
    || !Number.isSafeInteger(e.evaluatedAt) || !Number.isSafeInteger(e.reviewedAt)
    || e.evaluatedAt! <= 0 || e.evaluatedAt! > now || now - e.evaluatedAt! >= CODING_EVIDENCE_MAX_AGE_MS
    || e.reviewedAt! < e.evaluatedAt! || e.reviewedAt! > now
    || !Number.isSafeInteger(e.sampleCount) || e.sampleCount! < CODING_EVIDENCE_MIN_SAMPLES
    || !Number.isSafeInteger(e.passedCount) || e.passedCount! < 0 || e.passedCount! > e.sampleCount!) return null;
  const n = e.sampleCount!; const p = e.passedCount! / n; const z = 1.96; const zz = z * z;
  const lower = (p + zz / (2 * n) - z * Math.sqrt((p * (1 - p) + zz / (4 * n)) / n)) / (1 + zz / n);
  return { cohortKey: JSON.stringify([e.suiteId, e.suiteVersion]), sampleCount: n, passRate: p,
    confidenceLowerBound: Math.max(0, Math.min(1, lower)), evidenceReference: e.evidenceReference };
}
/**
 * Compute a single transitive sort key BEFORE sorting candidates. Pairwise "same suite
 * quality, otherwise health" comparators can cycle when unknown or mixed-suite entries exist.
 * Mixed suites get no quality bonus because their scores are not comparable. For one
 * reviewed suite, >=80% pass gets preference over unknown as a documented cold-start policy,
 * not a claim that an untested model is worse. Missing/expired evidence gets no invented score.
 */
export function codingQualityScores(ranks: ReadonlyArray<CodingEvidenceRank | null>): number[] {
  const cohorts = new Set(ranks.flatMap(rank => rank ? [rank.cohortKey] : []));
  if (cohorts.size !== 1) return ranks.map(() => 0);
  return ranks.map(rank => rank && rank.passRate >= CODING_EVIDENCE_PREFERENCE_PASS_RATE ? 1 + rank.confidenceLowerBound : 0);
}
