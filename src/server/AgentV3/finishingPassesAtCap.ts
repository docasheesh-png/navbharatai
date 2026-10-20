// AgentV3 — NOTHING THAT CHANGES THE APP RUNS AFTER THE CLOCK RAN OUT, BECAUSE NOTHING CAN CHECK IT (Q-1069).
//
// 🔴 WHY (autopsy 398db9f3 — PAWTRACE, 2026-10-14). The build hit its 25-minute cap. The finishing passes
// (unused-import sweep, production defaults) then wrote 16 files into an app that could not be re-opened,
// and the report said so itself: "The end state could not be checked, so nothing is known about whether they
// broke it" (`POST_GREEN_WRITES`, `GREEN_GUARD_NONE`). Those passes are designed to run BEFORE the preview
// proof so that what they write is verified like every other file; at the cap there is no time left for the
// proof, so they wrote and nobody looked.
//
// THE RULE (admin, 2026-10-14, "han" to the recommendation): after the wall-clock cap, only a pass that
// cannot change how the app behaves may write. Both finishing passes touch code, a service worker or a
// manifest, so both wait. A capped build is resumable by design: the next turn runs them with time to verify.
//
// PURE. A leaf: the route reads one function and one sentence.

import { MIN_CORRECTION_RESERVE_MS } from './correctionReserve';
import { abortBuild } from './buildAbortCause';

/** Did this run end because the wall-clock cap stopped it? */
export function capStoppedTheRun(result: { timedOut?: boolean } | null | undefined): boolean {
  return result?.timedOut === true;
}

/** May a pass that writes into the app (and is meant to be verified afterwards) run on this result? */
export function finishingPassMayRun(result: { timedOut?: boolean } | null | undefined): boolean {
  return !capStoppedTheRun(result);
}

/** The admin-report line for the passes that waited. Never user-facing. */
export function finishingPassesHeldNote(passes: readonly string[]): string {
  return `The wall-clock cap stopped this build, so ${passes.join(' and ')} did not write into the app: there was no time left to open it and check what they wrote. `
    + 'They run on the next turn, with time to verify.';
}

/**
 * Record `FINISHING_PASSES_HELD_AT_CAP`. Its own try lives here, not in the route: the chat handler sits at
 * TypeScript's control-flow limit (TS2563) and every branch added there is one more the checker must walk.
 */
export function recordFinishingPassesHeld(
  diag: { record(r: { phase: 'build'; severity: 'info'; code: string; message: string; autoResolved: boolean }): unknown },
): void {
  try {
    diag.record({ phase: 'build', severity: 'info', code: 'FINISHING_PASSES_HELD_AT_CAP', autoResolved: true, message: finishingPassesHeldNote(['the unused-import sweep', 'the production defaults']) });
  } catch { /* an advisory line must never affect a build */ }
}

/** The existing correction floor clears the >90s preview gate with room for its browser check. */
export const FINISHING_PROOF_RESERVE_MS = MIN_CORRECTION_RESERVE_MS;

export interface FinishingPassGuardDeps {
  result: () => { timedOut?: boolean } | null | undefined;
  aborted: () => boolean;
  signal?: AbortSignal;
  /** Live remaining wall clock; Infinity means the watchdog is disabled. */
  remainingMs: () => number;
  record: (note: { phase: 'build'; severity: 'info'; code: string; message: string; autoResolved: boolean }) => unknown;
}

/**
 * The result is a snapshot, not a clock. An earlier repair can spend the remaining window (or replace
 * that result) before the next optional pass starts. Check the live signal and clock before every
 * write, including writes reached after an awaited read, and keep the preview proof's own window.
 */
export function createFinishingPassGuard(d: FinishingPassGuardDeps): {
  allow: (pass: string) => boolean;
  write: (pass: string, action: () => Promise<unknown>) => Promise<boolean>;
  writeOrThrow: (pass: string, action: () => Promise<unknown>) => Promise<void>;
  repair: <T>(pass: string, action: (budgetMs: number, signal: AbortSignal) => Promise<T>) => Promise<T | null>;
  repairOrThrow: <T>(pass: string, action: (budgetMs: number, signal: AbortSignal) => Promise<T>) => Promise<T>;
  repairBudgetMs: () => number;
} {
  const held = new Set<string>();
  const allow = (pass: string): boolean => {
    const left = d.remainingMs();
    const reason = d.aborted() ? 'the build has been stopped'
      : capStoppedTheRun(d.result()) ? 'the generation run reached its time limit'
        : !(left > FINISHING_PROOF_RESERVE_MS) ? 'the remaining time is reserved for opening and verifying the app'
          : null;
    if (!reason) return true;
    if (!held.has(pass)) {
      held.add(pass);
      try {
        d.record({ phase: 'build', severity: 'info', code: 'FINISHING_PASSES_HELD_AT_CAP', autoResolved: true,
          message: `The ${pass} pass deferred its remaining writes because ${reason}. Completed writes are kept; deferred work can run on the next turn with time to verify.` });
      } catch { /* a timeline failure cannot authorize a write */ }
    }
    return false;
  };
  const repairBudgetMs = (): number => {
    const left = d.remainingMs();
    return left === Infinity ? 0 : Number.isFinite(left) ? Math.max(1, Math.floor(left - FINISHING_PROOF_RESERVE_MS)) : 1;
  };
  const repairOrThrow = async <T>(pass: string, action: (budgetMs: number, signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (!allow(pass)) throw new Error(`Finishing pass deferred: ${pass}`);
    const budgetMs = repairBudgetMs();
    const controller = new AbortController();
    const signal = d.signal ? AbortSignal.any([d.signal, controller.signal]) : controller.signal;
    // AgentRunner's watchdog is checked between turns. The signal also stops an in-flight model
    // request and refuses queued tools, so a long last turn cannot spend the proof reserve.
    const timer = budgetMs > 0 ? setTimeout(() => abortBuild(controller, 'repair-budget'), budgetMs) : null;
    try { return await action(budgetMs, signal); }
    finally { if (timer !== null) clearTimeout(timer); }
  };
  return {
    allow,
    write: async (pass, action) => {
      if (!allow(pass)) return false;
      await action();
      return true;
    },
    writeOrThrow: async (pass, action) => {
      if (!allow(pass)) throw new Error(`Finishing pass deferred: ${pass}`);
      await action();
    },
    repair: async (pass, action) => {
      if (!allow(pass)) return null;
      return repairOrThrow(pass, action);
    },
    repairOrThrow,
    // Never hand AgentRunner zero for an exhausted finite budget: zero disables its watchdog.
    repairBudgetMs,
  };
}
