// P1.3 — Circuit Breaker (UPGRADE v3.0).
//
// A real per-provider circuit breaker with the three canonical states:
//
//   • CLOSED     — provider is healthy; requests flow normally.
//   • OPEN       — provider recently failed; requests are blocked until a cooldown
//                  deadline passes. Consecutive failures ESCALATE the cooldown
//                  (exponential backoff, capped) so a persistently-broken provider
//                  is rested longer and longer instead of being hammered.
//   • HALF_OPEN  — the cooldown has elapsed but the provider hasn't proven healthy
//                  yet. The next request is allowed through as a TRIAL probe:
//                  success → CLOSED (reset); failure → OPEN again (escalated).
//
// Design notes:
//   - Pure & deterministic: every method takes `now` (defaults to Date.now()) so the
//     state machine is fully unit-testable without faking timers.
//   - Below the failure threshold the open cooldown equals exactly what the caller
//     requests, so this is a strict superset of the previous single-cooldown behaviour
//     — it never makes the router worse, only adds recovery + escalation.
//   - `isBlocking()` is the cheap read the router uses to skip a provider on the fast
//     path; once the cooldown elapses it returns false so the HALF_OPEN trial can run.

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Consecutive failures at/after which the cooldown begins escalating. Default 3. */
  failureThreshold?: number;
  /** Fallback cooldown (ms) when a failure doesn't specify one. Default 10s. */
  baseCooldownMs?: number;
  /** Upper bound for the escalated cooldown (ms). Default 5 min. */
  maxCooldownMs?: number;
}

const DEFAULTS: Required<CircuitBreakerOptions> = {
  failureThreshold: 3,
  baseCooldownMs: 10_000,
  maxCooldownMs: 300_000,
};

export class CircuitBreaker {
  private readonly opts: Required<CircuitBreakerOptions>;
  private consecutiveFailures = 0;
  /** Epoch ms; while OPEN and now < openedUntil, requests are blocked. */
  private openedUntil = 0;

  constructor(options: CircuitBreakerOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /** Derived state — CLOSED when no outstanding failures, OPEN while cooling down, HALF_OPEN once the cooldown elapses but recovery is unproven. */
  state(now: number = Date.now()): CircuitState {
    if (this.consecutiveFailures === 0) return 'closed';
    return now < this.openedUntil ? 'open' : 'half_open';
  }

  /** True only while the breaker is actively blocking (OPEN, cooldown not yet elapsed). HALF_OPEN returns false so a trial probe can proceed. */
  isBlocking(now: number = Date.now()): boolean {
    return this.state(now) === 'open';
  }

  /** Record a successful call → fully close the breaker and reset the failure streak. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedUntil = 0;
  }

  /**
   * Record a failed call. Opens the breaker for `cooldownMs` (or the configured base
   * when omitted). Once consecutive failures reach the threshold, the cooldown doubles
   * for each additional failure, capped at `maxCooldownMs`. A failure while HALF_OPEN
   * (i.e. a failed trial probe) re-opens with the same escalation.
   * Returns the epoch-ms deadline the breaker is now open until.
   */
  recordFailure(cooldownMs?: number, now: number = Date.now()): number {
    this.consecutiveFailures += 1;
    let ms = cooldownMs && cooldownMs > 0 ? cooldownMs : this.opts.baseCooldownMs;
    if (this.consecutiveFailures >= this.opts.failureThreshold) {
      const over = this.consecutiveFailures - this.opts.failureThreshold + 1; // 1, 2, 3…
      ms = Math.min(ms * Math.pow(2, over), this.opts.maxCooldownMs);
    }
    this.openedUntil = now + ms;
    return this.openedUntil;
  }

  /**
   * Honor a cooldown deadline observed from ANOTHER instance (cross-instance sync).
   * Never shortens a local cooldown; treats the provider as already failing so the
   * deadline sticks, but does not double-count toward escalation.
   */
  honorRemoteOpenUntil(until: number): void {
    if (until > this.openedUntil) {
      this.openedUntil = until;
      if (this.consecutiveFailures === 0) this.consecutiveFailures = 1;
    }
  }

  /** Observability snapshot — never mutate. */
  snapshot(now: number = Date.now()): { state: CircuitState; openedUntil: number; consecutiveFailures: number } {
    return { state: this.state(now), openedUntil: this.openedUntil, consecutiveFailures: this.consecutiveFailures };
  }
}

/**
 * Process-wide registry of per-provider breakers (module-level singleton, mirroring
 * how the router shares one cooldown map across all requests).
 */
const breakers = new Map<string, CircuitBreaker>();

export function getBreaker(name: string): CircuitBreaker {
  let b = breakers.get(name);
  if (!b) { b = new CircuitBreaker(); breakers.set(name, b); }
  return b;
}

/** All provider names that currently have a breaker (for stats/observability). */
export function allBreakerNames(): string[] {
  return [...breakers.keys()];
}

/** Test/diagnostic helper — clear all breaker state. */
export function resetAllBreakers(): void {
  breakers.clear();
}
