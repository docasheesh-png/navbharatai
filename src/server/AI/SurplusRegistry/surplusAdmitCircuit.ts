/**
 * Surplus admit circuit-breaker — skip Surplus admission during overload spikes.
 *
 * Product rule (owner continuous reliability, 2026-10-26): after SURPLUS_ADMITTED,
 * mid-build PUBLIC_BUILD_ENGINE_UNAVAILABLE / transport / timeout deaths with Files=0
 * already fail-open to Weak (`surplusPreWriteFailOpen`). That still burns one admit +
 * one Surplus call per build. When those deaths SPIKE, new admits should cool down and
 * go straight to the Weak/CHEAP_FLOOR ladder so Surplus is not overload-admitted into
 * the same death spiral.
 *
 * Deliberately NOT the AIRouter CircuitBreaker (which opens on the *first* failure):
 * a single flaky Surplus offer must not park all Weak Surplus admits. We open only
 * after `SURPLUS_ADMIT_CIRCUIT_FAILURE_THRESHOLD` consecutive mid-build deaths.
 *
 * Process-local. A fresh instance after a deploy starts CLOSED — fail-open toward
 * admitting, not fail-closed forever.
 */
import type { SurplusPreWriteFailOpenReason } from './surplusPreWriteFailOpen';

/** Safe admission reason when the admit circuit is OPEN. Never secret/URL-bearing. */
export const SURPLUS_ADMIT_CIRCUIT_OPEN_REASON = 'admit_circuit_open' as const;

/**
 * Two consecutive mid-build deaths after SURPLUS_ADMITTED = a spike.
 * One death can be a flaky offer; a second in a row trips cool-down.
 */
export const SURPLUS_ADMIT_CIRCUIT_FAILURE_THRESHOLD = 2;
/** Base cool-down once open (2 minutes). Escalates on further deaths up to max. */
// Owner 2026-10-31: recover faster so mid-game builds get Surplus back quickly (half-open probe soon).
export const SURPLUS_ADMIT_CIRCUIT_BASE_COOLDOWN_MS = 60_000;
/** Cap so a bad evening cannot park Surplus for hours without a half-open probe. */
export const SURPLUS_ADMIT_CIRCUIT_MAX_COOLDOWN_MS = 180_000;
/**
 * 🚫 A REFUSAL IS NOT A SPIKE (failedbr BR2514–BR2519, 2026-11-24). Six builds hours apart each spent 80–94 s on Surplus,
 * every model answering "the engine refused the request, HTTP 404", then fell back to the Weak ladder — the same 404s, build
 * after build, because the 1–3 min cool-down above (sized for an overload spike) had always expired before the next build.
 * An outright refusal (a 4xx other than 408/429 — buildSession `refusedOutright`) is the engine saying it will not serve
 * this, not a passing fault: it opens the circuit at ONCE for this long; then a half-open probe (one build) tries again.
 */
export const SURPLUS_ADMIT_CIRCUIT_REFUSAL_COOLDOWN_MS = 30 * 60_000;

export type SurplusAdmitCircuitState = 'closed' | 'open' | 'half_open';

type CircuitInternals = {
  consecutiveDeaths: number;
  openedUntil: number;
  lastOpenReason: string;
  /** Opens past the threshold — drives cooldown escalation (0 while closed). */
  opensInARow: number;
};

function fresh(): CircuitInternals {
  return { consecutiveDeaths: 0, openedUntil: 0, lastOpenReason: '', opensInARow: 0 };
}

let circuit = fresh();

function scrubReason(reason: string): string {
  return reason.trim().replace(/[^\w.:@/=+-]/g, '_').slice(0, 120);
}

/** Test helper — replace the process-local circuit with a fresh one. */
export function resetSurplusAdmitCircuitForTests(): void {
  circuit = fresh();
}

export function surplusAdmitCircuitSnapshot(now: number = Date.now()): {
  state: SurplusAdmitCircuitState;
  openedUntil: number;
  consecutiveDeaths: number;
  lastOpenReason: string;
} {
  return {
    state: stateAt(now),
    openedUntil: circuit.openedUntil,
    consecutiveDeaths: circuit.consecutiveDeaths,
    lastOpenReason: circuit.lastOpenReason,
  };
}

function stateAt(now: number): SurplusAdmitCircuitState {
  if (circuit.openedUntil > 0 && now < circuit.openedUntil) return 'open';
  if (circuit.openedUntil > 0 && now >= circuit.openedUntil) return 'half_open';
  return 'closed';
}

/**
 * True while the admit circuit is OPEN (cool-down not elapsed). HALF_OPEN returns
 * false so one trial admit can probe recovery. Armed-but-below-threshold stays false.
 */
export function shouldSkipSurplusAdmit(now: number = Date.now()): boolean {
  return stateAt(now) === 'open';
}

/**
 * Record a mid-build Surplus public-engine death after SURPLUS_ADMITTED (Files=0
 * fail-open path). Opens cool-down only once consecutive deaths hit the spike
 * threshold. Never throws. Returns openedUntil (0 when still closed/armed).
 */
export function recordSurplusMidBuildDeath(
  reason: SurplusPreWriteFailOpenReason | string,
  now: number = Date.now(),
  opts: { httpStatus?: number } = {},
): number {
  try {
    const safe = scrubReason(String(reason ?? 'mid_build_engine_unavailable') || 'mid_build_engine_unavailable');
    circuit.consecutiveDeaths += 1;
    circuit.lastOpenReason = safe;
    const st = opts.httpStatus;
    // 404 is NOT here: Surplus's 404s are market refusals of one (model, provider) pair (surplusPairRefusals.ts), and
    // parking the whole engine on one for 30 min kept Surplus out of builds the market could still fill (2026-11-25).
    if (typeof st === 'number' && st >= 400 && st < 500 && st !== 404 && st !== 408 && st !== 429) {
      circuit.opensInARow += 1;
      circuit.lastOpenReason = scrubReason(`${safe}:refused_${st}`);
      circuit.openedUntil = now + SURPLUS_ADMIT_CIRCUIT_REFUSAL_COOLDOWN_MS;
      return circuit.openedUntil;
    }

    if (circuit.consecutiveDeaths < SURPLUS_ADMIT_CIRCUIT_FAILURE_THRESHOLD) {
      return 0;
    }

    circuit.opensInARow += 1;
    const over = circuit.opensInARow; // 1, 2, 3…
    const ms = Math.min(
      SURPLUS_ADMIT_CIRCUIT_BASE_COOLDOWN_MS * Math.pow(2, over - 1),
      SURPLUS_ADMIT_CIRCUIT_MAX_COOLDOWN_MS,
    );
    circuit.openedUntil = now + ms;
    return circuit.openedUntil;
  } catch {
    return now + SURPLUS_ADMIT_CIRCUIT_BASE_COOLDOWN_MS;
  }
}

/**
 * Record a successful Surplus turn (pre-write path survived). Closes the circuit so
 * healthy traffic clears a prior spike. Never throws.
 */
export function recordSurplusAdmitProbeSuccess(): void {
  try {
    circuit = fresh();
  } catch { /* best-effort */ }
}
