// P-MON.3 — LLM observability: latency percentiles + per-provider aggregation.
//
// A pure, dependency-free stats core for inference-latency observability. `percentiles`
// summarises a sample of durations (p50/p90/p95/p99 + min/max/mean); `aggregateProviderLatency`
// turns the real `ai.provider.*` spans recorded by the AI router (Tracer) into per-provider
// latency + error-rate breakdowns.
//
// HONESTY: percentiles are computed from real recorded samples only. With no samples the
// engine reports zero counts and null percentiles — it never invents a latency figure.

export interface LatencySummary {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
}

/**
 * The q-quantile (0–1) of a numeric sample using linear interpolation between closest ranks.
 * Returns null for an empty sample. `values` need NOT be pre-sorted.
 */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, q));
  const pos = clamped * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

const round = (n: number | null): number | null => (n == null ? null : Math.round(n * 100) / 100);

/** Full latency summary (counts + key percentiles) of a duration sample. */
export function percentiles(values: number[]): LatencySummary {
  const valid = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (valid.length === 0) {
    return { count: 0, min: null, max: null, mean: null, p50: null, p90: null, p95: null, p99: null };
  }
  const sum = valid.reduce((a, b) => a + b, 0);
  return {
    count: valid.length,
    min: round(Math.min(...valid)),
    max: round(Math.max(...valid)),
    mean: round(sum / valid.length),
    p50: round(quantile(valid, 0.5)),
    p90: round(quantile(valid, 0.9)),
    p95: round(quantile(valid, 0.95)),
    p99: round(quantile(valid, 0.99)),
  };
}

export interface SpanLike {
  name: string;
  durationMs?: number;
  status?: string;
  attributes?: Record<string, unknown>;
}

export interface ProviderLatency {
  provider: string;
  errors: number;
  errorRatePct: number;
  latency: LatencySummary;
}

/**
 * Aggregate the AI-router provider spans (name `ai.provider.<NAME>`, attribute `provider`) into
 * per-provider latency percentiles + error rate. Spans without a recognised provider are ignored.
 */
export function aggregateProviderLatency(spans: SpanLike[]): ProviderLatency[] {
  const byProvider = new Map<string, { durations: number[]; errors: number; total: number }>();
  for (const s of spans) {
    const fromAttr = typeof s.attributes?.provider === 'string' ? (s.attributes.provider as string) : null;
    const fromName = s.name.startsWith('ai.provider.') ? s.name.slice('ai.provider.'.length) : null;
    const provider = fromAttr || fromName;
    if (!provider) continue;
    const bucket = byProvider.get(provider) || { durations: [], errors: 0, total: 0 };
    bucket.total += 1;
    if (s.status === 'error') bucket.errors += 1;
    if (typeof s.durationMs === 'number' && Number.isFinite(s.durationMs)) bucket.durations.push(s.durationMs);
    byProvider.set(provider, bucket);
  }
  const out: ProviderLatency[] = [];
  for (const [provider, b] of byProvider.entries()) {
    out.push({
      provider,
      errors: b.errors,
      errorRatePct: b.total > 0 ? Math.round((b.errors / b.total) * 1000) / 10 : 0,
      latency: percentiles(b.durations),
    });
  }
  // Most-used providers first (by sample count) for a stable, useful ordering.
  out.sort((a, b) => b.latency.count - a.latency.count || a.provider.localeCompare(b.provider));
  return out;
}
