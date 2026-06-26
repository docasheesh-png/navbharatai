// AgentV3 cost-ladder summary — PURE, frontend-safe aggregation for the admin
// dashboard. Takes the raw per-day telemetry docs (from
// GET /api/admin/agentv3/cost-telemetry) and rolls them up into the display
// numbers the dashboard shows. No I/O, fully unit-testable.
//
// HONEST by design: it only derives numbers the telemetry actually contains —
// build counts, per-tier success rate, billed totals, token/duration averages,
// and the headline "cheap-tier share" (what fraction of builds ran on the cheapest
// 'gemini' tier). It does NOT invent a "money saved" figure: that would need real
// per-model provider rates, which are not recorded here, so faking it is off the
// table (CLAUDE.md real-features rule).

/** One slice's rolled-up counters (matches the server TelemetryBreakdown shape). */
export interface TelemetryBreakdownLike {
  builds: number;
  okBuilds: number;
  billedUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

/** One day's telemetry doc (structural subset of the server DailyCostTelemetryDoc). */
export interface DailyTelemetryLike {
  date: string;
  totalBuilds: number;
  okBuilds: number;
  powerBuilds: number;
  totalBilledUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  byTaskType: Record<string, TelemetryBreakdownLike>;
  byStartTier: Record<string, TelemetryBreakdownLike>;
}

/** A display row for one tier or task type. */
export interface SummaryRow {
  key: string;
  builds: number;
  /** Share of all builds, 0-100, rounded to 1 dp. */
  sharePct: number;
  /** okBuilds / builds, 0-100, rounded to 1 dp. 0 when no builds. */
  successPct: number;
  billedUsd: number;
  /** Average (input+output) tokens per build, rounded. */
  avgTokens: number;
  /** Average wall-clock per build in seconds, rounded to 1 dp. */
  avgDurationSec: number;
}

export interface CostLadderSummary {
  totalBuilds: number;
  okBuilds: number;
  /** Overall success rate 0-100, 1 dp. */
  overallSuccessPct: number;
  powerBuilds: number;
  totalBilledUsd: number;
  /** % of builds that ran on the cheapest 'gemini' start tier, 0-100, 1 dp. */
  cheapTierSharePct: number;
  /** Per start-tier rows, ordered cheapest → most expensive then by builds. */
  byTier: SummaryRow[];
  /** Per task-type rows, ordered by builds desc. */
  byTask: SummaryRow[];
  /** Number of days covered by the data. */
  days: number;
}

const TIER_ORDER = ['gemini', 'haiku', 'sonnet', 'opus', 'unknown'];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? round1((part / whole) * 100) : 0;
}

function mergeBreakdown(
  into: Record<string, TelemetryBreakdownLike>,
  from: Record<string, TelemetryBreakdownLike> | undefined,
): void {
  if (!from) return;
  for (const [k, v] of Object.entries(from)) {
    const cur = into[k] ?? { builds: 0, okBuilds: 0, billedUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };
    into[k] = {
      builds: cur.builds + (v.builds || 0),
      okBuilds: cur.okBuilds + (v.okBuilds || 0),
      billedUsd: cur.billedUsd + (v.billedUsd || 0),
      inputTokens: cur.inputTokens + (v.inputTokens || 0),
      outputTokens: cur.outputTokens + (v.outputTokens || 0),
      durationMs: cur.durationMs + (v.durationMs || 0),
    };
  }
}

function toRow(key: string, b: TelemetryBreakdownLike, totalBuilds: number): SummaryRow {
  return {
    key,
    builds: b.builds,
    sharePct: pct(b.builds, totalBuilds),
    successPct: pct(b.okBuilds, b.builds),
    billedUsd: Math.round(b.billedUsd * 1_000_000) / 1_000_000,
    avgTokens: b.builds > 0 ? Math.round((b.inputTokens + b.outputTokens) / b.builds) : 0,
    avgDurationSec: b.builds > 0 ? round1(b.durationMs / b.builds / 1000) : 0,
  };
}

/**
 * Roll up N days of telemetry docs into the dashboard summary. Empty input yields
 * an all-zero summary (the dashboard shows an honest "no data yet" state).
 */
export function summarizeCostTelemetry(history: DailyTelemetryLike[]): CostLadderSummary {
  const docs = Array.isArray(history) ? history : [];
  let totalBuilds = 0;
  let okBuilds = 0;
  let powerBuilds = 0;
  let totalBilledUsd = 0;
  const byTier: Record<string, TelemetryBreakdownLike> = {};
  const byTask: Record<string, TelemetryBreakdownLike> = {};

  for (const d of docs) {
    totalBuilds += d.totalBuilds || 0;
    okBuilds += d.okBuilds || 0;
    powerBuilds += d.powerBuilds || 0;
    totalBilledUsd += d.totalBilledUsd || 0;
    mergeBreakdown(byTier, d.byStartTier);
    mergeBreakdown(byTask, d.byTaskType);
  }

  const tierRows = Object.entries(byTier)
    .map(([k, v]) => toRow(k, v, totalBuilds))
    .sort((a, b) => {
      const ia = TIER_ORDER.indexOf(a.key);
      const ib = TIER_ORDER.indexOf(b.key);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return b.builds - a.builds;
    });

  const taskRows = Object.entries(byTask)
    .map(([k, v]) => toRow(k, v, totalBuilds))
    .sort((a, b) => b.builds - a.builds);

  const cheapBuilds = byTier.gemini?.builds ?? 0;

  return {
    totalBuilds,
    okBuilds,
    overallSuccessPct: pct(okBuilds, totalBuilds),
    powerBuilds,
    totalBilledUsd: Math.round(totalBilledUsd * 1_000_000) / 1_000_000,
    cheapTierSharePct: pct(cheapBuilds, totalBuilds),
    byTier: tierRows,
    byTask: taskRows,
    days: docs.length,
  };
}
