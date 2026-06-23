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

// Per-defect penalties (points off 100).
const PENALTY = {
  unresolvedImport: 25, // breaks the build
  cycle: 8,
  layering: 5,
  securityHigh: 30,
  securityMedium: 8,
  securityLow: 2,
} as const;

export function assessReadiness(arch: ArchitectureReport, security: SecurityFinding[]): ReadinessReport {
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

  const high = security.filter((f) => f.severity === 'high').length;
  const medium = security.filter((f) => f.severity === 'medium').length;
  const low = security.filter((f) => f.severity === 'low').length;
  if (high) {
    score -= PENALTY.securityHigh * high;
    blockers.push(`${high} high-severity security issue(s)`);
  }
  if (medium) {
    score -= PENALTY.securityMedium * medium;
    warnings.push(`${medium} medium-severity security issue(s)`);
  }
  if (low) {
    score -= PENALTY.securityLow * low;
    warnings.push(`${low} low-severity security issue(s)`);
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
