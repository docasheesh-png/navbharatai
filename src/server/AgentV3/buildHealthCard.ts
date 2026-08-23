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
 * - score = an honest 0..100 from ok + the unresolved-problem counts, CAPPED below perfect unless the
 *   app was actually seen running (see the note inside — a perfect score must be earned, not defaulted).
 */
export function buildHealthFromDiagnostics(report: BuildDiagnosticsReport | undefined, ok: boolean): BuildHealth {
  const problems = report?.problems ?? [];
  const blockers = messages(problems.filter(p => p.severity === 'error' && !p.autoResolved));
  const warnings = messages(problems.filter(p => p.severity === 'warning' && !p.autoResolved));
  // A build the engine reported as not-ok is never "ready", even if no single blocker was captured.
  const ready = ok && blockers.length === 0;

  /**
   * 🔒 A PERFECT SCORE HAS TO BE EARNED (admin screenshot 2026-08-22).
   *
   * The card read "Build health: READY · 100/100" directly above the build's own text saying there
   * were "critical build-breaking issues that must be fixed before the app can compile", over a
   * preview that never came up. Two of our surfaces flatly contradicting, and the confident one was
   * wrong.
   *
   * The cause is in the arithmetic above, not in any missing check: the score starts at 100 and
   * subtracts problems — so "nothing was found" and "nothing was ever looked at" produce the same
   * number. A build whose app was never seen running scored exactly what a proven-working one scores.
   * That is this codebase's recurring conflation, this time inside the score itself.
   *
   * `OUTCOME_BUILD_SUCCESS` is only ever recorded by recordPreviewVerified() — the app opened in a
   * real browser and rendered. So its ABSENCE means "not proven", and an unproven build is capped
   * below perfect and says why. It is deliberately NOT marked not-ready: we did not see it work, and
   * we did not see it fail either, and claiming breakage would be the opposite lie.
   */
  const provenRunning = problems.some((p) => p.code === 'OUTCOME_BUILD_SUCCESS');
  const UNPROVEN_CAP = 85;
  const raw = (ok ? 100 : 45) - 25 * blockers.length - 6 * warnings.length;
  const score = clamp(provenRunning ? raw : Math.min(raw, UNPROVEN_CAP));
  const unprovenNote = 'The app was not seen running, so this checks the code — it is not proof the app works.';

  return {
    score,
    ready,
    blockers,
    warnings: provenRunning || !ready ? warnings : [unprovenNote, ...warnings].slice(0, MAX_LISTED),
    provenRunning,
  };
}
