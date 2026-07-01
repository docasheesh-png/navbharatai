/**
 * Persistence-failure telemetry (C3).
 *
 * Every server-side Firestore store swallows its errors best-effort so a persistence hiccup never
 * crashes a build (correct). The cost of that safety was INVISIBILITY: when the bundled AI-Studio
 * free-tier database exhausts its daily write quota — or FIRESTORE_DATABASE_ID points at the wrong
 * database — every write silently no-ops and the user's chat/files/memory vanish on reload
 * ("reload pe data gayab") with zero signal in the logs or the app.
 *
 * This module gives those swallowed failures a voice WITHOUT changing the best-effort behaviour:
 *  • notePersistenceFailure() records the failure and emits a throttled, greppable Cloud Run log
 *    line (at most once per 30s per scope+op, so a sustained outage can't spam the logs).
 *  • persistenceHealth() exposes a snapshot an admin can read from a diagnostic endpoint to CONFIRM
 *    "persistence is silently failing" instead of guessing.
 *
 * It never throws and holds no external resources — importing/using it is always safe.
 */

export type PersistenceOp = 'init' | 'read' | 'write';

interface HealthState {
  failures: number;
  firstAt: number;
  lastAt: number;
  lastScope: string;
  lastOp: PersistenceOp;
  lastError: string;
}

const state: HealthState = {
  failures: 0,
  firstAt: 0,
  lastAt: 0,
  lastScope: '',
  lastOp: 'write',
  lastError: '',
};

/** When each scope+op was last logged, so a sustained outage logs at most once per window. */
const lastLoggedAt = new Map<string, number>();
const LOG_THROTTLE_MS = 30_000;

/**
 * Record one swallowed persistence failure. Called from inside a store's best-effort catch — it
 * NEVER throws and NEVER changes control flow; it only makes the failure observable. `now` is
 * injectable so the throttle/counters are deterministic under test.
 */
export function notePersistenceFailure(
  scope: string,
  op: PersistenceOp,
  err: unknown,
  now: number = Date.now(),
): void {
  state.failures += 1;
  if (state.firstAt === 0) state.firstAt = now;
  state.lastAt = now;
  state.lastScope = scope;
  state.lastOp = op;
  state.lastError = err instanceof Error ? err.message : String(err ?? 'unknown error');

  const key = `${scope}:${op}`;
  const prev = lastLoggedAt.get(key);
  if (prev === undefined || now - prev >= LOG_THROTTLE_MS) {
    lastLoggedAt.set(key, now);
    // eslint-disable-next-line no-console
    console.warn(
      `[PERSISTENCE_FAILURE] scope=${scope} op=${op} total=${state.failures} error=${state.lastError.slice(0, 300)}`,
    );
  }
}

export interface PersistenceHealth {
  /** True until the first swallowed failure is recorded this process. */
  healthy: boolean;
  failures: number;
  lastScope: string | null;
  lastOp: PersistenceOp | null;
  lastError: string | null;
  lastAt: number | null;
  firstAt: number | null;
}

/** A read-only snapshot for a diagnostic surface. Pure. */
export function persistenceHealth(): PersistenceHealth {
  return {
    healthy: state.failures === 0,
    failures: state.failures,
    lastScope: state.lastScope || null,
    lastOp: state.failures > 0 ? state.lastOp : null,
    lastError: state.lastError || null,
    lastAt: state.lastAt || null,
    firstAt: state.firstAt || null,
  };
}

/** Test-only: reset the module state between cases. */
export function __resetPersistenceHealth(): void {
  state.failures = 0;
  state.firstAt = 0;
  state.lastAt = 0;
  state.lastScope = '';
  state.lastOp = 'write';
  state.lastError = '';
  lastLoggedAt.clear();
}
