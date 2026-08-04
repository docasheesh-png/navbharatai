// AgentV3 — Software Project Mode (SPM-3): the auto-continue decision, PURE.
//
// Layer-3 auto-continue was built for ONE failure shape: a build that pauses at the wall-clock
// limit. Its fixed budget (2 continues per user message) is right for that — a genuinely stuck
// build must never loop forever. But a PROJECT-MODE build legitimately needs MANY continues: a
// 40-module plan is 40 successful module turns, each ending in a `resumable` result. Capping that
// at 2 would make the user type "continue" twenty times through a build they asked to run
// unattended ("5000 files bina atke").
//
// The fix is not a bigger number — it is a DIFFERENT guard: plan-mode results carry
// `planRemaining` (modules not yet done), and the loop continues only while that number STRICTLY
// DECREASES. Real progress → keep going (and refresh the pause budget for the next module);
// stalled progress → stop and hand back honestly. A time-limit pause DURING a module (no
// `planRemaining` on that result) still uses the classic bounded pause budget — reset per module,
// so module 30 gets the same pause tolerance module 1 had. An absolute session cap backstops
// everything. This module is pure + fully unit-testable; AgentV3Panel just wires the refs.

/** Classic budget: consecutive NO-PROGRESS deadline-pause continues before we stop (a stuck build). */
export const PAUSE_CONTINUE_MAX = 2;
/** Absolute backstop for progress-driven wall-clock continues in one user message — a big full-stack
 *  app legitimately needs several 30-min windows, but this bounds a pathological case. Each window that
 *  adds NEW files counts against it; a build adding files every window finishes unattended within it. */
export const PAUSE_PROGRESS_MAX = 8;
/** Absolute backstop for plan-driven continues in one unattended chain (server MAX_MODULES is 60;
 *  failed-module retries can add a few more turns — this cap should never bind on a real plan). */
export const PLAN_CONTINUE_MAX = 100;

export interface AutoContinueDecision {
  /** True → fire start('continue') for the next round. */
  proceed: boolean;
  /** True → this was real plan progress; reset the pause budget for the next module. */
  resetPauseBudget: boolean;
  /** True → count this continue against the plan budget (else against the pause budget). */
  isPlanContinue: boolean;
  /** Honest hand-back message when stopping. Undefined while proceeding. */
  stopMessage?: string;
}

export function decideAutoContinue(input: {
  /** `planRemaining` from THIS result (undefined/null outside project mode). */
  planRemaining: number | null | undefined;
  /** `planRemaining` from the PREVIOUS plan-mode result in this chain (null when none yet). */
  lastPlanRemaining: number | null;
  /** Deadline-pause continues used since the last user message (both progress + no-progress). */
  pauseContinues: number;
  /** Plan-driven continues used in this unattended chain. */
  planContinues: number;
  /** Total files written SO FAR at THIS wall-clock pause (undefined outside a deadline pause / when unknown). */
  filesWritten?: number | null;
  /** Files written at the PREVIOUS pause in this chain (null when this is the first pause). */
  lastFilesWritten?: number | null;
  /** Consecutive NO-PROGRESS pauses so far (files did not grow) — reset to 0 on any progress. */
  noProgressPauses?: number;
}): AutoContinueDecision {
  const { planRemaining, lastPlanRemaining, pauseContinues, planContinues } = input;

  if (typeof planRemaining === 'number') {
    // Project mode: a module turn finished ok with modules left.
    if (planContinues >= PLAN_CONTINUE_MAX) {
      return {
        proceed: false, resetPauseBudget: false, isPlanContinue: true,
        stopMessage: `This project has auto-continued ${planContinues} times — pausing for a checkpoint. Type **"continue"** to keep building the remaining ${planRemaining} module(s).`,
      };
    }
    if (lastPlanRemaining !== null && planRemaining >= lastPlanRemaining) {
      // No real progress since the last plan result — a loop guard, not a verdict. Hand back.
      return {
        proceed: false, resetPauseBudget: false, isPlanContinue: true,
        stopMessage: `The project plan is not advancing (${planRemaining} module(s) still remaining). Review the last module's result, then type **"continue"** to retry.`,
      };
    }
    return { proceed: true, resetPauseBudget: true, isPlanContinue: true };
  }

  // Classic: a wall-clock pause (no plan signal). PROGRESS-DRIVEN (FleetOps/deep-test 2026-07-20):
  // a big full-stack app legitimately needs several 30-min windows. Continue for as long as the build
  // is still ADDING FILES each window (real progress), bounded by an absolute backstop; only fall back
  // to the tight 2-continue budget when a window makes NO progress (a genuinely stuck build). This is
  // what makes a 30+min app finish unattended instead of pausing midway asking the user to type continue.
  const { filesWritten, lastFilesWritten, noProgressPauses } = input;
  const haveProgressSignal = typeof filesWritten === 'number';
  const madeProgress = haveProgressSignal && (lastFilesWritten == null || (filesWritten as number) > lastFilesWritten);

  // Absolute backstop — even a steadily-progressing build can't auto-continue forever.
  if (pauseContinues >= PAUSE_PROGRESS_MAX) {
    return {
      proceed: false, resetPauseBudget: false, isPlanContinue: false,
      stopMessage: `This build has already auto-continued ${pauseContinues} times and is still going — pausing for a checkpoint. Type **"continue"** to keep finishing it.`,
    };
  }
  // Still making progress each window → keep going. resetPauseBudget stays FALSE: the caller keeps the
  // ABSOLUTE pauseContinues counter climbing toward PAUSE_PROGRESS_MAX (it must never reset, or a
  // steadily-progressing build would auto-continue forever); the caller resets only its no-progress streak.
  if (madeProgress) {
    return { proceed: true, resetPauseBudget: false, isPlanContinue: false };
  }
  // No new files this window (or no progress signal at all) → the classic tight budget guards a stuck build.
  if ((noProgressPauses ?? pauseContinues) >= PAUSE_CONTINUE_MAX) {
    return {
      proceed: false, resetPauseBudget: false, isPlanContinue: false,
      stopMessage: 'This build is taking longer than the time limit allows even after auto-continuing. Type **"continue"** and I will keep finishing it.',
    };
  }
  return { proceed: true, resetPauseBudget: false, isPlanContinue: false };
}
