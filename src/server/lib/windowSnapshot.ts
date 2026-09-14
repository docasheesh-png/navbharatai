// A MetricsSnapshot for the WINDOW the admin is looking at, built from the durable timeline.
//
// 🔴 WHY THIS EXISTS (admin Monitor capture, 2026-09-14). The Monitor's charts read the Firestore
// timeline for the selected window — 3 builds, ₹231.36, 4.0M tokens over six hours. Beneath them,
// on the same page, Insights said *"No builds or model calls have been recorded in this window"*
// and Platform Health said *"No data yet for: success"* — and then scored Reliability 100 beside
// three failed builds. Those panels were fed `getMetrics().snapshot()`: the per-instance,
// since-boot registry, which a deploy resets to zero. The server had restarted 49 seconds earlier.
//
// So after EVERY deploy the two halves of the page contradict each other for as long as it takes
// the registry to refill — and the half that contradicts the evidence is the half that claims to
// analyse it. The "Since this server started" panel is labelled; Insights and Health were not, and
// Insights said "in this window" in so many words.
//
// This module turns the timeline window into the snapshot shape those analysers already accept, so
// they analyse the same data the charts draw. It carries a `provenance` saying what it could NOT
// carry: the timeline records builds, previews, tokens and cost, but not repair attempts or the
// edit/fresh split. Those fields are 0 with `repairsTracked: false` — and a consumer that would say
// "0 repair attempts" must check the flag rather than print a zero it has no measurement for.
//
// PURE. No I/O; the caller hands in the series it already read.

import type { MetricsSnapshot } from './metrics';
import type { TimelineSeries } from './metricsTimeline';

export interface MetricsScope {
  /** Where the analysed numbers came from. */
  source: 'window' | 'since-boot';
  /** The window in hours when `source` is 'window'. */
  hours: number | null;
  /** ISO start of what was analysed. */
  since: string;
  /** False when the source does not record repair attempts (the timeline does not). */
  repairsTracked: boolean;
  /** Human label for the panels: "the last 6 hours" / "since this server started". */
  label: string;
}

/** The scope label for a window, shared so every panel says the same words. PURE. */
export function windowLabel(hours: number): string {
  if (hours % 24 === 0 && hours >= 24) {
    const d = hours / 24;
    return `the last ${d} day${d === 1 ? '' : 's'}`;
  }
  return `the last ${hours} hour${hours === 1 ? '' : 's'}`;
}

/** Build the snapshot the analysers consume from the timeline the charts draw. PURE. */
export function windowSnapshot(series: TimelineSeries, hours: number): { snapshot: MetricsSnapshot; scope: MetricsScope } {
  const s = series.summary;
  const tokens: MetricsSnapshot['tokens'] = {};
  for (const [name, p] of Object.entries(series.providers ?? {})) {
    if (!p) continue;
    tokens[name] = {
      requests: num(p.requests),
      inputTokens: num(p.inputTokens),
      outputTokens: num(p.outputTokens),
      costUsd: num(p.costMicroUsd) / 1_000_000,
    };
  }
  const total = num(s.builds);
  const succeeded = num(s.buildsOk);
  const previewAllowed = num(s.previewOk);
  const totalMs = num(s.buildMs);
  const snapshot: MetricsSnapshot = {
    tokens,
    totalCostUsd: Math.round(num(s.costUsd) * 1e6) / 1e6,
    builds: {
      total,
      succeeded,
      failed: num(s.buildsFailed),
      previewAllowed,
      // Not recorded by the timeline. Zero with `repairsTracked: false` in the scope — see the header.
      edits: 0,
      freshBuilds: 0,
      totalRepairAttempts: 0,
      totalMs,
      successRate: total ? succeeded / total : 0,
      previewRate: total ? previewAllowed / total : 0,
      avgMs: total ? Math.round(totalMs / total) : 0,
    },
    since: new Date(num(series.from)).toISOString(),
  };
  return {
    snapshot,
    scope: {
      source: 'window',
      hours,
      since: snapshot.since,
      repairsTracked: false,
      label: windowLabel(hours),
    },
  };
}

/** The scope object for the since-boot registry, so the two sources describe themselves the same way. PURE. */
export function sinceBootScope(snapshot: MetricsSnapshot, uptimeSeconds: number): MetricsScope {
  return {
    source: 'since-boot',
    hours: null,
    since: snapshot.since,
    repairsTracked: true,
    label: `since this server started (${Math.max(0, Math.round(uptimeSeconds))}s ago)`,
  };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
