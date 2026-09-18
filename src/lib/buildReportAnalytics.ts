// Build-report failure analytics (M8-S8.1) — turn the admin Build-Reports inbox into a data-driven
// signal: WHICH failure class recurs most, so the roadmap is prioritised from real evidence instead of
// guesswork. Pure + isomorphic (no server deps) so the admin dashboard computes it client-side from the
// already-fetched report list, and it is unit-testable without any network.

import { classifyFailureReason } from './failureReason';

/** The minimal report shape this analysis needs (a structural subset of the admin report row). */
export interface FailureAnalyticsInput {
  ok: boolean | null;
  rootCause: string | null;
  /**
   * The build's own `OUTCOME_*` code and its severity — a machine fact, read BEFORE the prose by the
   * shared classifier. Absent on a report filed before the code was projected into its meta; the text
   * is then the honest fallback, exactly as for a legacy record on the server's Failure Category panel.
   */
  outcomeCode?: string | null;
  outcomeSeverity?: string | null;
  appLabel?: string | null;
  /** Build duration in ms (for the speed signal); optional so failure analysis ignores it. */
  buildMs?: number | null;
}

export interface BuildTimeSummary {
  /** Number of builds that carried a usable duration. */
  counted: number;
  /** Average build time in ms (0 when none). */
  avgMs: number;
  /** Median build time in ms (0 when none). */
  medianMs: number;
  /** The slowest builds, newest-count first, capped. */
  slowest: Array<{ app: string; ms: number }>;
}

/**
 * Summarise build DURATIONS across a set of reports — the speed signal (M6-S6.1). Only builds with a
 * positive numeric buildMs are counted; returns avg, median and the slowest builds. Pure — never throws.
 */
export function summarizeBuildTimes(reports: FailureAnalyticsInput[], topN = 5): BuildTimeSummary {
  const list = Array.isArray(reports) ? reports : [];
  const timed = list.filter((r) => r && typeof r.buildMs === 'number' && Number.isFinite(r.buildMs) && (r.buildMs as number) > 0);
  const durations = timed.map((r) => r.buildMs as number);
  if (durations.length === 0) return { counted: 0, avgMs: 0, medianMs: 0, slowest: [] };
  const sum = durations.reduce((a, b) => a + b, 0);
  const sorted = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const slowest = [...timed]
    .sort((a, b) => (b.buildMs as number) - (a.buildMs as number))
    .slice(0, Math.max(1, topN))
    .map((r) => ({ app: r.appLabel || 'Untitled build', ms: r.buildMs as number }));
  return { counted: durations.length, avgMs: Math.round(sum / durations.length), medianMs, slowest };
}

export interface FailurePattern {
  /** Stable machine key from the shared classifier (`empty-build`, `other`, …). Never derived from text. */
  key: string;
  /** A short, human category label (e.g. "React Rules-of-Hooks violation"). */
  label: string;
  /** How many failed builds fall into this pattern. */
  count: number;
  /** One representative rootCause line (verbatim, capped) for the admin to eyeball. */
  sample: string;
  /** Up to 3 distinct app labels that hit this pattern. */
  apps: string[];
}

export interface FailureSummary {
  totalReports: number;
  totalFailed: number;
  patterns: FailurePattern[];
}

/**
 * 🔴 THE CARD READS THE ONE CLASSIFIER NOW (admin, 2026-09-17 — the "Top failure patterns" card).
 *
 * This file used to carry its own nine-rule regex list and, for anything it did not match, used the
 * first line of `rootCause` — numbers and file names stripped — AS THE BUCKET LABEL. The admin's card
 * then read, at 25% each:
 *
 *     🔍 I analyzed your project — no files were changed. Overview:
 *     The GLM rung answered inside its clock and produced nothing, because our own output ceilin…
 *     Tool call failed: edit_file: old_string not found in <file>. The string you supplied does…
 *
 * A "pattern" that is one build's own sentence is not a pattern: every novel sentence becomes its own
 * row, and the card can never say "this class recurs". Its fourth row, `Sandbox / preview did not
 * come up`, came from a rule that matched the bare word `port` — which is also inside "report",
 * "import" and "support".
 *
 * `src/lib/failureReason.ts` is the classifier the server's Failure Category panel already used; it
 * reads the build's own `OUTCOME_*` code before its prose, its patterns are grounded in real engine
 * strings, and an unmatched reason is a stable "Other" whose raw sentence rides in `sample` for the
 * admin to read. Both panels now answer the same question the same way.
 */
function categoryFor(r: FailureAnalyticsInput): { key: string; label: string } {
  return classifyFailureReason(r.rootCause, r.outcomeCode ?? null, r.outcomeSeverity ?? null);
}

/**
 * Summarise the recurring failure patterns across a set of build reports. Only FAILED builds
 * (ok === false) with a rootCause are counted; the result is sorted by frequency, then capped.
 * Pure — never throws, tolerant of junk input.
 */
export function summarizeFailurePatterns(reports: FailureAnalyticsInput[], topN = 8): FailureSummary {
  const list = Array.isArray(reports) ? reports : [];
  const failed = list.filter((r) => r && r.ok === false && typeof r.rootCause === 'string' && r.rootCause.trim());
  const buckets = new Map<string, { label: string; count: number; sample: string; apps: Set<string> }>();
  for (const r of failed) {
    const cause = (r.rootCause as string).trim();
    const { key, label } = categoryFor(r);
    const b = buckets.get(key) ?? { label, count: 0, sample: cause.split('\n')[0].slice(0, 160), apps: new Set<string>() };
    b.count += 1;
    if (r.appLabel && b.apps.size < 3) b.apps.add(r.appLabel);
    buckets.set(key, b);
  }
  const patterns: FailurePattern[] = [...buckets.entries()]
    .map(([key, b]) => ({ key, label: b.label, count: b.count, sample: b.sample, apps: [...b.apps] }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, Math.max(1, topN));
  return { totalReports: list.length, totalFailed: failed.length, patterns };
}
