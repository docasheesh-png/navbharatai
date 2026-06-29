/**
 * P-BRE.9 — Circuit breaker for build-pipeline steps (per-engine).
 *
 * `ExecutionOrchestrator` has retries but no breaker: if one generation engine repeatedly hangs
 * or fails, every build keeps paying the full timeout before failing. This wraps each engine
 * dispatch with a per-engine `CircuitBreaker` so a sick engine FAST-FAILS (3 failures → open for a
 * cooldown → half-open trial probe) instead of dragging every build down, and surfaces a
 * `STAGE_CIRCUIT_OPEN` signal the AutoRepairEngine can act on.
 *
 * Reuses the proven, unit-tested `CircuitBreaker` from the AI router (same CLOSED/OPEN/HALF_OPEN
 * semantics) but keeps build-step breakers in a SEPARATE registry so they don't pollute the
 * AI-provider breaker stats shown in the admin dashboard.
 */
import { CircuitBreaker } from '../AI/Router/CircuitBreaker';

/** Error thrown when a build step is fast-failed because its breaker is open. */
export class CircuitOpenError extends Error {
  constructor(public readonly step: string, public readonly openUntil: number) {
    super(`Build step "${step}" circuit is OPEN (fast-fail); retry after cooldown.`);
    this.name = 'CircuitOpenError';
  }
}

/** Consecutive failures before a build step's breaker fast-fails (the spec's "3 failures → open"). */
export const FAILURE_THRESHOLD = 3;

// Separate process-wide registry — NOT the AI-provider one.
const stepBreakers = new Map<string, CircuitBreaker>();

/** Get (or lazily create) the breaker for a named build step / engine. */
export function getStepBreaker(step: string): CircuitBreaker {
  let b = stepBreakers.get(step);
  if (!b) {
    // Escalating cooldown starting at 60s (the spec's fast-fail window).
    b = new CircuitBreaker({ failureThreshold: FAILURE_THRESHOLD, baseCooldownMs: 60_000, maxCooldownMs: 300_000 });
    stepBreakers.set(step, b);
  }
  return b;
}

/**
 * True when a step should FAST-FAIL: the breaker is in cooldown AND it has reached the consecutive-
 * failure threshold. The underlying breaker also opens a cooldown on the FIRST failure (its general
 * design), but for build steps we only want to block once a step has genuinely proven sick
 * (3 failures), so a single transient engine error doesn't lock the engine out for a minute.
 */
function shouldFastFail(breaker: CircuitBreaker): boolean {
  return breaker.isBlocking() && breaker.snapshot().consecutiveFailures >= FAILURE_THRESHOLD;
}

export function allStepBreakerNames(): string[] {
  return [...stepBreakers.keys()];
}

/** Test/diagnostic helper — clear all build-step breaker state. */
export function resetStepBreakers(): void {
  stepBreakers.clear();
}

/**
 * Run `fn` for a named build step under its circuit breaker.
 *  - If the breaker is OPEN → throw `CircuitOpenError` immediately (fast-fail), invoking
 *    `onOpen` first so the caller can emit `STAGE_CIRCUIT_OPEN` and pick a fallback.
 *  - On success → record success (closes the breaker).
 *  - On failure → record failure (may open the breaker) and rethrow the original error.
 */
export async function runWithBreaker<T>(
  step: string,
  fn: () => Promise<T>,
  onOpen?: (info: { step: string; openUntil: number }) => void,
): Promise<T> {
  const breaker = getStepBreaker(step);
  if (shouldFastFail(breaker)) {
    const snap = breaker.snapshot();
    onOpen?.({ step, openUntil: snap.openedUntil });
    throw new CircuitOpenError(step, snap.openedUntil);
  }
  try {
    const result = await fn();
    breaker.recordSuccess();
    return result;
  } catch (err) {
    const openUntil = breaker.recordFailure();
    // If THIS failure tipped the breaker to the threshold, signal STAGE_CIRCUIT_OPEN.
    if (shouldFastFail(breaker)) onOpen?.({ step, openUntil });
    throw err;
  }
}
