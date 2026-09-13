/**
 * THE PARENT'S DEADLINE, CARRIED DOWN TO THE CHILD THAT SPENDS IT.
 *
 * ROOT CAUSE (admin report 2026-09-13, recorded as an OPEN item in PROGRESS.md the same day).
 * The fast lane caps its plan call at 90 s; the Kimi rung's own client timeout is 120 s. The parent
 * deadline was SHORTER than the child's, and `withTimeout` only RACES — it stops waiting, it does not
 * stop the call. So that build kept logging provider events **148 seconds after the build had ended**,
 * on a sandbox still being billed by the minute, generating tokens nobody would ever read.
 *
 * Nothing was misconfigured. The two numbers were each chosen well, in different files, months apart,
 * by people answering different questions — "how long may this lane wait?" and "how long may this
 * provider take?" — and no mechanism existed for the first answer to reach the second. That is the bug
 * class, and it is why this module is a contract rather than a smaller number somewhere.
 *
 * THE SHAPE: an ABSOLUTE timestamp (`deadlineAt`), never a duration. A duration would have to be
 * decremented by hand at every hop, and the multi-provider chain walks several rungs per call — the
 * second rung would silently be handed the whole budget again. An absolute instant composes for free:
 * every hop subtracts nothing and simply asks how much clock is left.
 *
 * 🔒 IT CAN ONLY EVER SHORTEN A CALL. With no deadline the answer is the configured bound, unchanged,
 * to the byte — which is what makes adopting it one caller at a time safe. The single case where it
 * lengthens is a runner that had NO bound at all, and bounding an unbounded call is the safe direction.
 *
 * 🔴 AND IT MUST NOT LIE ABOUT WHOSE FAULT THE FAILURE WAS. `isTimeoutProviderError` benches a provider
 * after two consecutive timeouts. A provider handed 8 seconds because the LANE had 8 seconds left has
 * not failed at anything, and benching it would punish it for our budgeting. So `source` says which
 * clock ran out, and the caller words the error accordingly — a budget failure must never read as a
 * provider timeout (rule 5 step 5: fix the system's honesty too).
 */

/** Which clock decided this call's bound. */
export type DeadlineSource = 'configured' | 'deadline' | 'none';

export interface TurnDeadlineDecision {
  /** The bound to actually apply. 0 means "no bound" — only ever returned when `source` is 'none'. */
  timeoutMs: number;
  /** The parent's budget was already spent: do not start this call at all. */
  expired: boolean;
  /** Whose clock produced `timeoutMs`. */
  source: DeadlineSource;
}

/**
 * Below this there is no honest call to make: the round trip alone costs more, so starting one would
 * spend tokens to produce a result that arrives after its reader has gone. Deliberately small — this
 * is "the budget is gone", not a quality threshold.
 */
export const MIN_USEFUL_CALL_MS = 250;

/** The error a call refused for lack of budget throws. Worded so `isTimeoutProviderError` does NOT
 *  match it — the provider did nothing wrong and must not be benched for our clock. */
export const BUDGET_EXHAUSTED_MESSAGE = 'build budget exhausted before this call could start';

/** The error a call bounded BY THE PARENT'S DEADLINE throws when it overruns. Same reasoning: this is
 *  our budget ending, not the provider being slow, so it must not read as a provider timeout. */
export const BUDGET_REACHED_MESSAGE = 'build budget reached while this call was still running';

function finitePositive(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Reconcile a runner's own configured bound with the caller's remaining budget.
 *
 * @param configuredMs the runner's own timeout. `<= 0` means the runner has no bound of its own.
 * @param deadlineAt   absolute epoch-ms instant the CALLER stops caring. Anything not a finite
 *                     positive number (undefined, null, NaN, 0, a negative) means "no deadline", and
 *                     the answer is then today's behaviour exactly.
 */
export function turnDeadline(configuredMs: number, deadlineAt?: number | null, now: number = Date.now()): TurnDeadlineDecision {
  const configured = finitePositive(configuredMs);
  const at = finitePositive(deadlineAt);

  // NO DEADLINE → byte-identical to the behaviour that existed before this module. Every unknown
  // resolves toward today, so a caller that has not thought about budget cannot be harmed by it.
  if (at === null) {
    return configured === null
      ? { timeoutMs: 0, expired: false, source: 'none' }
      : { timeoutMs: configured, expired: false, source: 'configured' };
  }

  const remaining = at - now;
  if (remaining < MIN_USEFUL_CALL_MS) {
    return { timeoutMs: 0, expired: true, source: 'deadline' };
  }
  if (configured === null) {
    // An unbounded runner gains a bound. The one case where a deadline makes a call SHORTER than it
    // could otherwise have been is also the one case where it was previously unbounded.
    return { timeoutMs: remaining, expired: false, source: 'deadline' };
  }
  return remaining < configured
    ? { timeoutMs: remaining, expired: false, source: 'deadline' }
    : { timeoutMs: configured, expired: false, source: 'configured' };
}

/**
 * Turn a remaining-budget duration into the absolute instant every hop below can read. Returns
 * undefined for a non-positive or unmeasurable budget, so `deadlineAt` stays absent rather than
 * becoming an instant already in the past — "we did not measure" and "there is no time left" are
 * different facts and only the second should stop a call.
 */
export function deadlineFromBudget(remainingMs: number | null | undefined, now: number = Date.now()): number | undefined {
  const ms = finitePositive(remainingMs);
  return ms === null ? undefined : now + ms;
}
