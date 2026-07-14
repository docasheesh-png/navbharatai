import type { ReadinessReport } from './Readiness';

// AgentV3 — weak-tier mid-build CHECKPOINT (Slice 2, admin-requested 2026-07-14).
//
// Slice 1 (weakBuildDiscipline) tells the weak model HOW to build (core-first). This slice adds an
// EVIDENCE-based safety net: on a weak build, every N steps run the FREE deterministic readiness scan
// and — ONLY for build-breakers that are real regardless of how complete the app is — inject one
// corrective steer so the weak model fixes it NOW, instead of drifting to the step cap and delivering
// a broken app.
//
// THE CRITICAL CORRECTNESS RULE — no false alarms. A mid-build app is legitimately incomplete, so
// most readiness blockers ("unresolved import", "readiness score below floor") are NORMAL and would
// be WRONG to steer on (the imported file is simply the next one the model will write). Steering on
// those would waste the weak model's scarce steps — the opposite of the goal. So we steer ONLY on
// COMPLETENESS-INDEPENDENT build-breakers:
//   • a server-only Node builtin imported by browser code (a wrong architecture choice — the App #12
//     class — that never becomes correct by writing more files), and
//   • a high-severity security finding (e.g. a leaked secret — real now and after the app is done).
// Everything else is left to the mandatory END-of-build readiness gate + Claude/Vertex escalation.

/**
 * Blocker-substring contracts, matched against the blocker strings Readiness.ts emits. Kept here as
 * the single place the classifier's assumptions live; the contract test (weakBuildCheckpoint.test.ts)
 * runs the REAL assessReadiness producer and asserts it still emits these substrings, so a wording
 * change in Readiness.ts can never silently disable the filter.
 */
export const ACTIONABLE_BLOCKER_PATTERNS: RegExp[] = [
  /server-only Node builtin/i, // nodeBuiltinsInFrontend — breaks the browser build regardless of completeness
  /high-severity security/i, //   securityHigh — real now and after the app is finished
];

/** Blockers that are NORMAL for an incomplete mid-build app and must NEVER trigger a steer. */
export const MID_BUILD_FALSE_ALARM_PATTERNS: RegExp[] = [
  /unresolved import/i, //         the imported file is simply the next one to be written
  /readiness score .* below/i, //  a partial app scores low by construction
];

export interface WeakCheckpointConfig {
  /** Master switch — default OFF (opt-in AGENTV3_WEAK_CHECKPOINT=on), canary before wide rollout. */
  enabled: boolean;
  /** Run the scan every N steps. */
  everyN: number;
  /** Warm-up: do not check before this step (a skeleton should exist first). */
  minStep: number;
  /** Bounded nudges per build so a checkpoint can never itself burn the step budget. */
  maxNudges: number;
}

export function weakCheckpointConfig(env: NodeJS.ProcessEnv = process.env): WeakCheckpointConfig {
  const int = (v: string | undefined, d: number, min: number): number => {
    const n = parseInt(v ?? '', 10);
    return Number.isFinite(n) && n >= min ? n : d;
  };
  return {
    enabled: env.AGENTV3_WEAK_CHECKPOINT === 'on',
    everyN: int(env.AGENTV3_WEAK_CHECKPOINT_EVERY, 20, 1),
    minStep: int(env.AGENTV3_WEAK_CHECKPOINT_MIN_STEP, 15, 1),
    maxNudges: int(env.AGENTV3_WEAK_CHECKPOINT_MAX_NUDGES, 2, 1),
  };
}

/** Whether to run the checkpoint scan on THIS step. Pure — the caller supplies the live counters. */
export function shouldRunWeakCheckpoint(p: {
  isWeakBuild: boolean;
  cfg: WeakCheckpointConfig;
  step: number;
  toolUses: number;
  nudgesUsed: number;
}): boolean {
  const { isWeakBuild, cfg, step, toolUses, nudgesUsed } = p;
  if (!isWeakBuild || !cfg.enabled) return false;
  if (toolUses <= 0) return false; //            nothing built yet → nothing to check
  if (step < cfg.minStep) return false; //       warm-up: let a skeleton exist first
  if (nudgesUsed >= cfg.maxNudges) return false; // bounded — never burn steps nagging
  return step % cfg.everyN === 0;
}

/** The blockers worth steering on mid-build (completeness-independent build-breakers only). */
export function midBuildActionableBlockers(readiness: ReadinessReport): string[] {
  return readiness.blockers.filter((b) => ACTIONABLE_BLOCKER_PATTERNS.some((re) => re.test(b)));
}

/** The ONE corrective steer message to inject, or null when nothing actionable was found. */
export function weakCheckpointSteer(readiness: ReadinessReport): string | null {
  const actionable = midBuildActionableBlockers(readiness);
  if (actionable.length === 0) return null;
  return [
    '[BUILD CHECKPOINT] An automatic check found a real build-breaker in what you have written so far.',
    'Fix ONLY this before writing any new feature — it will not fix itself by adding more files:',
    ...actionable.map((b) => `- ${b}`),
    'Keep the app compiling; do not start new features until this is resolved.',
  ].join('\n');
}
