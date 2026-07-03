// AgentV3 — Deployment-readiness scoring (Phase 9, cat 26).
//
// Combines the real architecture and security findings into a single, honest 0–100
// readiness score and a hard ready/not-ready gate. Deterministic (same inputs →
// same score), so it can back a real "is this app done?" decision instead of the
// agent declaring success by vibes. Build-breakers (unresolved imports) and
// high-severity security issues are hard blockers — they force ready=false no
// matter the score.

import type { ArchitectureReport } from './ArchitectureAnalysis';
import type { SecurityFinding } from './SecurityAnalysis';

export interface ReadinessReport {
  /** 0–100; 100 = no detected defects. */
  score: number;
  /** Hard gate: false if there is any build-breaker or high-severity security issue. */
  ready: boolean;
  /** Must-fix items (block readiness). */
  blockers: string[];
  /** Should-fix items (lower the score but do not block). */
  warnings: string[];
}

/**
 * An additional readiness signal from another evaluate dimension (runnability,
 * secret-leak, security-config, requirement-coverage, …). `high` is a hard blocker;
 * `medium`/`low` lower the score as warnings. Lets the readiness gate account for
 * the full evaluate suite, not just architecture + security.
 */
export interface ExtraFinding {
  severity: 'high' | 'medium' | 'low';
  label: string;
}

// Per-defect penalties (points off 100).
const PENALTY = {
  unresolvedImport: 25, // breaks the build
  cycle: 8,
  layering: 5,
  orphanComponent: 6, // the app compiles, but a generated component is never shown to the user
  securityHigh: 30,
  securityMedium: 8,
  securityLow: 2,
} as const;

export function assessReadiness(
  arch: ArchitectureReport,
  security: SecurityFinding[],
  extra: ExtraFinding[] = [],
): ReadinessReport {
  const blockers: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  if (arch.unresolvedImports.length) {
    score -= PENALTY.unresolvedImport * arch.unresolvedImports.length;
    blockers.push(`${arch.unresolvedImports.length} unresolved import(s) — the build will fail`);
  }
  if (arch.cycles.length) {
    score -= PENALTY.cycle * arch.cycles.length;
    warnings.push(`${arch.cycles.length} import cycle(s)`);
  }
  if (arch.layeringViolations.length) {
    score -= PENALTY.layering * arch.layeringViolations.length;
    warnings.push(`${arch.layeringViolations.length} layering violation(s)`);
  }
  if (arch.orphanComponents.length) {
    // Warning, not a blocker: the app still compiles and runs — it just won't SHOW the component,
    // which is a real quality defect but not something that should force a rebuild-from-scratch loop
    // (a false positive here — e.g. a component genuinely reserved for a next feature — must never
    // block a real, working build).
    score -= PENALTY.orphanComponent * arch.orphanComponents.length;
    warnings.push(`${arch.orphanComponents.length} component(s) created but never used: ${arch.orphanComponents.slice(0, 3).join(', ')}${arch.orphanComponents.length > 3 ? ', …' : ''}`);
  }

  // Surface the ACTUAL finding (rule @ file:line — message), not just a count, so the build report
  // tells the reader WHAT the security issue is and WHERE — otherwise "1 high-severity security
  // issue(s)" is un-actionable (you can't fix what you can't see). Bounded to the first few per tier
  // so a noisy scan can't bloat the report.
  const fmtFinding = (f: SecurityFinding): string => `${f.rule} @ ${f.file}:${f.line} — ${f.message}`;
  const detail = (fs: SecurityFinding[]): string => `${fs.slice(0, 5).map(fmtFinding).join(' | ')}${fs.length > 5 ? ' | …' : ''}`;
  const high = security.filter((f) => f.severity === 'high');
  const medium = security.filter((f) => f.severity === 'medium');
  const low = security.filter((f) => f.severity === 'low');
  if (high.length) {
    score -= PENALTY.securityHigh * high.length;
    blockers.push(`${high.length} high-severity security issue(s): ${detail(high)}`);
  }
  if (medium.length) {
    score -= PENALTY.securityMedium * medium.length;
    warnings.push(`${medium.length} medium-severity security issue(s): ${detail(medium)}`);
  }
  if (low.length) {
    score -= PENALTY.securityLow * low.length;
    warnings.push(`${low.length} low-severity security issue(s): ${detail(low)}`);
  }

  // Extra signals from the rest of the evaluate suite. High = hard blocker.
  for (const e of extra) {
    if (e.severity === 'high') {
      score -= PENALTY.securityHigh;
      blockers.push(e.label);
    } else if (e.severity === 'medium') {
      score -= PENALTY.securityMedium;
      warnings.push(e.label);
    } else {
      score -= PENALTY.securityLow;
      warnings.push(e.label);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const ready = blockers.length === 0;
  return { score, ready, blockers, warnings };
}

/** A one-line honest verdict for the top of the evaluate report. */
export function readinessVerdict(r: ReadinessReport): string {
  const head = r.ready
    ? `Deployment readiness: READY — score ${r.score}/100.`
    : `Deployment readiness: NOT READY — score ${r.score}/100. Must fix: ${r.blockers.join('; ')}.`;
  return r.warnings.length ? `${head} Warnings: ${r.warnings.join('; ')}.` : head;
}
