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

/** A human-facing maturity grade derived from the readiness score + gate. */
export type MaturityTier = 'prototype' | 'hackathon' | 'production' | 'enterprise';

export interface ReadinessReport {
  /** 0–100; 100 = no detected defects. */
  score: number;
  /** Hard gate: false if there is any build-breaker or high-severity security issue. */
  ready: boolean;
  /** Must-fix items (block readiness). */
  blockers: string[];
  /** Should-fix items (lower the score but do not block). */
  warnings: string[];
  /** Maturity tier derived from the score + gate (prototype → hackathon → production → enterprise). */
  tier: MaturityTier;
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

// The readiness SCORE floor. A build can be free of any single categorised HARD blocker yet still be
// riddled with quality defects that crater the score (real admin evidence, 2026-07-05: 27 orphan
// components alone drove the score to 0, and — because `ready` only checked `blockers.length` — the
// engine reported "Build health: READY · 0/100", a self-evident lie the user rightly did not trust).
// A low score is ITSELF a not-ready signal: readiness now requires BOTH no hard blocker AND a score at
// or above this floor, so "READY · <low>/100" can never be emitted again. 50 = at least half the
// 100-point defect budget must remain; a genuinely clean build sits far above it, so this never
// false-blocks a real, working app.
export const MIN_READY_SCORE = 50;

/**
 * Map a readiness result to a maturity tier the user understands. A not-ready build (a hard blocker or a
 * sub-floor score) is at most a PROTOTYPE; above the floor it climbs hackathon → production → enterprise as
 * the score approaches pristine. Pure — same inputs, same tier.
 */
export function maturityTier(r: { ready: boolean; score: number; blockers: string[] }): MaturityTier {
  if (!r.ready || r.blockers.length > 0 || r.score < MIN_READY_SCORE) return 'prototype';
  if (r.score < 70) return 'hackathon';
  if (r.score < 90) return 'production';
  return 'enterprise';
}

/** A short, honest human description for a maturity tier. Pure. */
export function maturityTierLabel(t: MaturityTier): string {
  switch (t) {
    case 'prototype': return 'Prototype — not production-ready; fix the blockers first.';
    case 'hackathon': return 'Hackathon-grade — works, but has rough edges to polish.';
    case 'production': return 'Production-ready — solid, safe to ship.';
    case 'enterprise': return 'Enterprise-grade — pristine, no detected defects.';
  }
}

// Per-defect penalties (points off 100).
const PENALTY = {
  unresolvedImport: 25, // breaks the build
  nodeBuiltin: 25, // a server-only Node builtin imported by front-end code breaks the browser build
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
    // Surface WHICH imports are unresolved (like the sibling node-builtin blocker below), not just the
    // count — a bare count is undiagnosable (ShopSphere autopsy: "1 unresolved import" with no specifier
    // could not be diagnosed from the report). arch.unresolvedImports items are "file -> spec" strings.
    const sample = arch.unresolvedImports.slice(0, 3).join(', ');
    blockers.push(`${arch.unresolvedImports.length} unresolved import(s) — the build will fail: ${sample}${arch.unresolvedImports.length > 3 ? ', …' : ''}`);
  }
  if (arch.nodeBuiltinsInFrontend.length) {
    // A server-only Node builtin (fs/child_process/net/…) imported by front-end code breaks the
    // browser build (Vite externalizes it → runtime crash / build failure). This is a hard
    // build-breaker like an unresolved import — it must BLOCK, not silently pass as READY. It was
    // computed by ArchitectureAnalysis and shown in the report, but the readiness gate never read it.
    score -= PENALTY.nodeBuiltin * arch.nodeBuiltinsInFrontend.length;
    blockers.push(`${arch.nodeBuiltinsInFrontend.length} server-only Node builtin import(s) in front-end code — these break the browser build: ${arch.nodeBuiltinsInFrontend.slice(0, 3).join(', ')}${arch.nodeBuiltinsInFrontend.length > 3 ? ', …' : ''}`);
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
  // HONESTY GATE: a score below the floor is a not-ready signal on its own, even with no single hard
  // blocker — otherwise a pile of "warning" defects (orphan components, cycles, …) that craters the
  // score still reports READY. Record an honest reason so the verdict says WHY, never a silent
  // "READY · <low>/100".
  if (score < MIN_READY_SCORE && blockers.length === 0) {
    const why = warnings.length ? ` — ${warnings.slice(0, 2).join('; ')}${warnings.length > 2 ? ', …' : ''}` : '';
    blockers.push(`readiness score ${score}/100 is below the ${MIN_READY_SCORE}/100 bar (too many unresolved quality issues${why})`);
  }
  const ready = blockers.length === 0;
  return { score, ready, blockers, warnings, tier: maturityTier({ ready, score, blockers }) };
}

/** A one-line honest verdict for the top of the evaluate report. */
export function readinessVerdict(r: ReadinessReport): string {
  const head = r.ready
    ? `Deployment readiness: READY — score ${r.score}/100.`
    : `Deployment readiness: NOT READY — score ${r.score}/100. Must fix: ${r.blockers.join('; ')}.`;
  return r.warnings.length ? `${head} Warnings: ${r.warnings.join('; ')}.` : head;
}
