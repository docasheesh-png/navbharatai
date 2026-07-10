// T1-health-card (roadmap Tier 1B) — surface the build's objective readiness as a build-health card.
//
// The whole spine already exists and is DORMANT: the `BuildHealth` type, the `done`/`result` event field,
// the reducer that stores it, and the <BuildHealthCard/> that renders it. The one missing wire is the
// SERVER never producing a BuildHealth on a successful build (only the failure path emitted `done`, without
// readiness). This derives an HONEST BuildHealth from the diagnostics report the build already computed —
// zero extra analysis, zero extra cost — so the card finally shows.
//
// PURE: reads the finished BuildDiagnosticsReport + the honest ok verdict. No I/O.

import type { BuildHealth } from './types';
import type { BuildDiagnosticsReport, BuildIssue } from './BuildDiagnostics';

const MAX_LISTED = 6;

/** Dedupe issue messages (keeping order) and cap the list so the card stays readable. */
function messages(issues: BuildIssue[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of issues) {
    const m = (i.message || i.code || '').trim();
    if (m && !seen.has(m)) { seen.add(m); out.push(m); if (out.length >= MAX_LISTED) break; }
  }
  return out;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Derive the build-health verdict from the finished diagnostics + the build's honest ok flag. Pure.
 * - blockers = still-UNRESOLVED errors (severity 'error', autoResolved false) — the things that make the
 *   app not ready. A build that reported ok:false with no captured error is still not ready.
 * - warnings = still-unresolved warnings — advisory, non-blocking.
 * - ready = the build completed AND nothing is blocking.
 * - score = an honest 0..100 synthesized from ok + the unresolved-problem counts.
 */
export function buildHealthFromDiagnostics(report: BuildDiagnosticsReport | undefined, ok: boolean): BuildHealth {
  const problems = report?.problems ?? [];
  const blockers = messages(problems.filter(p => p.severity === 'error' && !p.autoResolved));
  const warnings = messages(problems.filter(p => p.severity === 'warning' && !p.autoResolved));
  // A build the engine reported as not-ok is never "ready", even if no single blocker was captured.
  const ready = ok && blockers.length === 0;
  const score = clamp((ok ? 100 : 45) - 25 * blockers.length - 6 * warnings.length);
  return { score, ready, blockers, warnings };
}
