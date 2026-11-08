/** Admin-only, synthetic capability comparison. Never promotes a production model. */
export const DEEPINFRA_COMPARISON_MODELS = ['deepseek-ai/DeepSeek-V4-Flash-0731', 'deepseek-ai/DeepSeek-V4.1-Flash-1017'] as const;
export type ComparisonModel = typeof DEEPINFRA_COMPARISON_MODELS[number];
export const COMPARISON_CASES = ['hindi', 'math', 'json', 'tool', 'stream', 'typescript'] as const;
export type ComparisonCase = typeof COMPARISON_CASES[number];
export const COMPARISON_MAX_USD = 2;
export interface ComparisonRate { model: ComparisonModel; inputPerMillion: number; outputPerMillion: number; contextTokens: number }
export interface ComparisonCaseResult {
  model: ComparisonModel; task: ComparisonCase; passed: boolean; reason: string;
  latencyMs: number; firstTokenMs: number | null;
  inputTokens: number | null; outputTokens: number | null;
  costUsd: number | null; reservedUsd: number; settlementConfirmed: boolean;
}
export interface ComparisonSummary {
  model: ComparisonModel; passed: number; attempted: number; total: number;
  medianLatencyMs: number | null; totalCostUsd: number | null; costPerPassedCaseUsd: number | null;
}
export interface ComparisonReport {
  version: 1; runId: string; startedAt: number; endedAt: number; catalogObservedAt: number;
  rates: ComparisonRate[]; results: ComparisonCaseResult[]; summaries: ComparisonSummary[];
  completed: boolean; stopReason: string | null;
}
export interface ComparisonStatus {
  configured: boolean; catalogAvailable: boolean; catalogObservedAt: number | null;
  rates: ComparisonRate[]; maxRunUsd: number; maximumReservationUsd: number | null;
  budgetAvailable: boolean; remainingBudgetUsd: number | null; running: boolean;
  tariffDigest: string | null;
  lastReport: ComparisonReport | null;
}
export function readComparisonAction(value: unknown): { runId: string; reason: string; tariffDigest: string; acceptPublishedRates: true } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return Object.keys(v).every(k => ['runId', 'reason', 'tariffDigest', 'acceptPublishedRates'].includes(k)) && typeof v.runId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v.runId) &&
    typeof v.reason === 'string' && v.reason.trim().length >= 10 && v.reason.trim().length <= 500 &&
    typeof v.tariffDigest === 'string' && /^[a-f0-9]{64}$/.test(v.tariffDigest) && v.acceptPublishedRates === true
    ? { runId: v.runId, reason: v.reason.trim(), tariffDigest: v.tariffDigest, acceptPublishedRates: true } : null;
}
export function summarizeComparison(results: ComparisonCaseResult[]): ComparisonSummary[] {
  return DEEPINFRA_COMPARISON_MODELS.map(model => {
    const rows = results.filter(r => r.model === model);
    const passed = rows.filter(r => r.passed).length;
    const times = rows.filter(r => r.passed).map(r => r.latencyMs).sort((a, b) => a - b);
    const medianLatencyMs = times.length ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2 : null;
    const totalCostUsd = rows.length === COMPARISON_CASES.length && rows.every(r => r.costUsd !== null)
      ? rows.reduce((sum, r) => sum + r.costUsd!, 0) : null;
    return { model, passed, attempted: rows.length, total: COMPARISON_CASES.length, medianLatencyMs,
      totalCostUsd, costPerPassedCaseUsd: totalCostUsd !== null && passed > 0 ? totalCostUsd / passed : null };
  });
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const optionalNumber = (v: unknown) => v === null || finite(v);
const model = (v: unknown) => (DEEPINFRA_COMPARISON_MODELS as readonly unknown[]).includes(v);
function isRate(v: unknown): v is ComparisonRate {
  return object(v) && model(v.model) && finite(v.inputPerMillion) && finite(v.outputPerMillion) &&
    Number.isSafeInteger(v.contextTokens) && Number(v.contextTokens) > 0;
}
export function isComparisonReport(v: unknown): v is ComparisonReport {
  return object(v) && v.version === 1 && typeof v.runId === 'string' && finite(v.startedAt) && finite(v.endedAt) &&
    finite(v.catalogObservedAt) && typeof v.completed === 'boolean' && (v.stopReason === null || typeof v.stopReason === 'string') &&
    Array.isArray(v.rates) && v.rates.length === 2 && v.rates.every(isRate) &&
    Array.isArray(v.results) && v.results.length <= 12 && v.results.every(r => object(r) && model(r.model) &&
      (COMPARISON_CASES as readonly unknown[]).includes(r.task) && typeof r.passed === 'boolean' && typeof r.reason === 'string' &&
      finite(r.latencyMs) && optionalNumber(r.firstTokenMs) && optionalNumber(r.inputTokens) && optionalNumber(r.outputTokens) &&
      optionalNumber(r.costUsd) && finite(r.reservedUsd) && typeof r.settlementConfirmed === 'boolean') &&
    Array.isArray(v.summaries) && v.summaries.length === 2 && v.summaries.every(s => object(s) && model(s.model) &&
      finite(s.passed) && finite(s.attempted) && s.total === 6 && optionalNumber(s.medianLatencyMs) && optionalNumber(s.totalCostUsd) && optionalNumber(s.costPerPassedCaseUsd));
}
export function isComparisonStatus(v: unknown): v is ComparisonStatus {
  return object(v) && typeof v.configured === 'boolean' && typeof v.catalogAvailable === 'boolean' &&
    optionalNumber(v.catalogObservedAt) && Array.isArray(v.rates) && v.rates.every(isRate) && v.maxRunUsd === COMPARISON_MAX_USD &&
    optionalNumber(v.maximumReservationUsd) && typeof v.budgetAvailable === 'boolean' && optionalNumber(v.remainingBudgetUsd) &&
    typeof v.running === 'boolean' && (v.tariffDigest === null || typeof v.tariffDigest === 'string' && /^[a-f0-9]{64}$/.test(v.tariffDigest)) &&
    (v.lastReport === null || isComparisonReport(v.lastReport));
}
