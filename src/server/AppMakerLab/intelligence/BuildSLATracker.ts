import { BuildJob, JobStatus } from '../jobs/BuildJobManager';
import { percentile } from '../jobs/BuildAnalytics';

/**
 * P-PME.11 — Build-time SLA / SLO tracker.
 *
 * A build that drags on for minutes is a degraded experience but nothing flagged it. This classifies
 * each build's expected SLO from its complexity and evaluates whether it met it, and summarizes SLO
 * compliance (violation rate + p95) per complexity tier. Pure + dependency-free + unit-tested; the
 * route + best-effort persistence layer feed it real `BuildJob` records.
 */

export type AppComplexity = 'simple' | 'complex';

/** SLO targets (ms): a simple app should build in ≤ 60s, a complex one in ≤ 300s. */
export const SLO_TARGETS_MS: Record<AppComplexity, number> = { simple: 60_000, complex: 300_000 };

// Signals in the build prompt that indicate a non-trivial app (→ the more lenient SLO).
const COMPLEX_SIGNALS = /\b(auth|login|sign[\s-]?up|dashboard|database|db|payment|checkout|stripe|admin|real[\s-]?time|websocket|chat|multi[\s-]?step|backend|server|api|crud|e-?commerce|cart|booking|upload)\b/i;

/** Classify an app's complexity from its build prompt (heuristic, deterministic). */
export function classifyComplexity(prompt: string | undefined | null): AppComplexity {
  const p = String(prompt || '');
  if (p.length > 280) return 'complex';
  if (COMPLEX_SIGNALS.test(p)) return 'complex';
  return 'simple';
}

const TERMINAL = new Set<JobStatus>([JobStatus.PREVIEW_READY, JobStatus.FAILED]);

function durationMs(job: BuildJob): number {
  const start = new Date(job.createdAt).getTime();
  const end = new Date(job.updatedAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : 0;
}

export interface SloEvaluation {
  complexity: AppComplexity;
  sloMs: number;
  durationMs: number;
  withinSlo: boolean;
  /** How far over the SLO the build ran (0 when within). */
  overByMs: number;
}

/** Evaluate a single build against its complexity-derived SLO. */
export function evaluateSlo(job: BuildJob): SloEvaluation {
  const complexity = classifyComplexity(job.prompt);
  const sloMs = SLO_TARGETS_MS[complexity];
  const dur = durationMs(job);
  const overByMs = Math.max(0, dur - sloMs);
  return { complexity, sloMs, durationMs: dur, withinSlo: overByMs === 0, overByMs };
}

export interface SloTierSummary { tier: AppComplexity; builds: number; violations: number; violationRate: number; p95Ms: number; sloMs: number }
export interface SloSummary {
  totalBuilds: number;
  totalViolations: number;
  overallViolationRate: number;
  byTier: SloTierSummary[];
}

/** Summarize SLO compliance across builds, split by complexity tier (terminal builds only). */
export function summarizeSlo(jobs: BuildJob[]): SloSummary {
  const tiers: AppComplexity[] = ['simple', 'complex'];
  const buckets: Record<AppComplexity, { durations: number[]; violations: number }> = {
    simple: { durations: [], violations: 0 },
    complex: { durations: [], violations: 0 },
  };
  let totalBuilds = 0;
  let totalViolations = 0;

  for (const job of jobs) {
    if (!TERMINAL.has(job.status)) continue;
    const ev = evaluateSlo(job);
    totalBuilds++;
    buckets[ev.complexity].durations.push(ev.durationMs);
    if (!ev.withinSlo) { buckets[ev.complexity].violations++; totalViolations++; }
  }

  const byTier: SloTierSummary[] = tiers.map((tier) => {
    const b = buckets[tier];
    return {
      tier,
      builds: b.durations.length,
      violations: b.violations,
      violationRate: b.durations.length ? b.violations / b.durations.length : 0,
      p95Ms: percentile(b.durations, 95),
      sloMs: SLO_TARGETS_MS[tier],
    };
  });

  return {
    totalBuilds,
    totalViolations,
    overallViolationRate: totalBuilds ? totalViolations / totalBuilds : 0,
    byTier,
  };
}
