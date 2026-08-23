/**
 * Phase 5 — Observability: token-usage, cost, and build-outcome metrics.
 *
 * A single, process-wide registry the live AI/build flow records into, so the
 * platform has REAL numbers (cost per provider, build success rate, time-to-build)
 * instead of the old unused ObservabilityManager/TokenUsageManager stubs. Pure +
 * dependency-free → unit-testable; exposed (read-only) via an admin endpoint.
 */

/** Approximate USD price per 1M tokens [input, output], keyed by provider name. */
const PRICING_PER_MTOK: Record<string, { in: number; out: number }> = {
  claude: { in: 3, out: 15 },        // Sonnet-class proxy
  aiRouter: { in: 0.1, out: 0.4 },   // mixed routing — rough blended estimate
  gemini: { in: 0.075, out: 0.3 },   // flash-class
  groq: { in: 0.05, out: 0.08 },
  openai: { in: 0.15, out: 0.6 },    // gpt-4o-mini
  deepseek: { in: 0.14, out: 0.28 },
  openrouter: { in: 0.14, out: 0.28 },
};
const DEFAULT_PRICE = { in: 0.2, out: 0.6 };

/** Rough token estimate from text length (~4 chars/token) — good enough for cost trend. */
export function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / 4) : 0;
}

function costUsd(provider: string, inTok: number, outTok: number): number {
  const p = PRICING_PER_MTOK[provider] || DEFAULT_PRICE;
  return (inTok / 1_000_000) * p.in + (outTok / 1_000_000) * p.out;
}

interface ProviderUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface BuildStats {
  total: number;
  succeeded: number;   // verify ok
  failed: number;
  previewAllowed: number;
  edits: number;
  freshBuilds: number;
  totalMs: number;
  totalRepairAttempts: number;
}

export interface MetricsSnapshot {
  tokens: Record<string, ProviderUsage>;
  totalCostUsd: number;
  builds: BuildStats & { successRate: number; previewRate: number; avgMs: number };
  since: string;
}

/**
 * A side-channel that mirrors every recorded number somewhere else (today: the Monitor timeline).
 *
 * WHY A HOOK AND NOT A DIRECT IMPORT. This module is deliberately pure and dependency-free so it can
 * be unit-tested without Firestore or a server. The timeline needs Firestore. Injecting the sink
 * keeps the ONE recording funnel here — every existing and future caller of recordBuild /
 * recordModelCall feeds the timeline automatically — without dragging storage into a pure module.
 * Adding a second, parallel recording call at each call site is exactly the drift this avoids.
 */
export interface MetricsSink {
  onModelCall?(provider: string, inputTokens: number, outputTokens: number, costUsd: number): void;
  onBuild?(o: { ok: boolean; previewAllowed: boolean; isEdit?: boolean; ms: number; repairAttempts?: number; sandboxSeconds?: number }): void;
}

let _sink: MetricsSink | null = null;

/** Register (or clear, with null) the metrics sink. Called once at server boot. */
export function setMetricsSink(sink: MetricsSink | null): void {
  _sink = sink;
}

export class MetricsRegistry {
  private tokens: Record<string, ProviderUsage> = {};
  private builds: BuildStats = {
    total: 0, succeeded: 0, failed: 0, previewAllowed: 0,
    edits: 0, freshBuilds: 0, totalMs: 0, totalRepairAttempts: 0,
  };
  private readonly since = new Date().toISOString();

  /**
   * Record one model call's token use + cost under a provider.
   *
   * `knownCostUsd` is the REAL cost when the caller has it (AgentV3 prices every call against the
   * live rate card in providerRates.ts). Without it we fall back to the approximate table at the top
   * of this file — which is fine for a usage trend, but is why any surface built on it must say
   * "estimated" rather than presenting it as measured money.
   */
  recordModelCall(provider: string, inputTokens: number, outputTokens: number, knownCostUsd?: number): void {
    const u = this.tokens[provider] || (this.tokens[provider] = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    u.requests += 1;
    u.inputTokens += Math.max(0, inputTokens);
    u.outputTokens += Math.max(0, outputTokens);
    const cost = typeof knownCostUsd === 'number' && Number.isFinite(knownCostUsd) && knownCostUsd >= 0
      ? knownCostUsd
      : costUsd(provider, Math.max(0, inputTokens), Math.max(0, outputTokens));
    u.costUsd += cost;
    // Never let a sink failure lose the metric that was just recorded here.
    try { _sink?.onModelCall?.(provider, Math.max(0, inputTokens), Math.max(0, outputTokens), cost); } catch { /* telemetry never throws */ }
  }

  /** Record the outcome of one build/edit run. */
  recordBuild(o: { ok: boolean; previewAllowed: boolean; isEdit?: boolean; ms: number; repairAttempts?: number; /** Real E2B VM seconds this build held — passed to the sink for the admin cost view, deliberately NOT added to MetricsSnapshot (which feeds insights/FinOps/health, none of which judge infra time). */ sandboxSeconds?: number }): void {
    this.builds.total += 1;
    if (o.ok) this.builds.succeeded += 1; else this.builds.failed += 1;
    if (o.previewAllowed) this.builds.previewAllowed += 1;
    if (o.isEdit) this.builds.edits += 1; else this.builds.freshBuilds += 1;
    this.builds.totalMs += Math.max(0, o.ms);
    this.builds.totalRepairAttempts += Math.max(0, o.repairAttempts ?? 0);
    try { _sink?.onBuild?.(o); } catch { /* telemetry never throws */ }
  }

  snapshot(): MetricsSnapshot {
    const totalCostUsd = Object.values(this.tokens).reduce((s, u) => s + u.costUsd, 0);
    const b = this.builds;
    return {
      tokens: JSON.parse(JSON.stringify(this.tokens)),
      totalCostUsd: Math.round(totalCostUsd * 1e6) / 1e6,
      builds: {
        ...b,
        successRate: b.total ? b.succeeded / b.total : 0,
        previewRate: b.total ? b.previewAllowed / b.total : 0,
        avgMs: b.total ? Math.round(b.totalMs / b.total) : 0,
      },
      since: this.since,
    };
  }
}

let _shared: MetricsRegistry | null = null;
/** Process-wide metrics registry (shared by the build route + admin endpoint). */
export function getMetrics(): MetricsRegistry {
  if (!_shared) _shared = new MetricsRegistry();
  return _shared;
}
