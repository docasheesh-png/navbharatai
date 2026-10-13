/**
 * EVERY SECOND BEFORE THE FIRST MODEL CALL BELONGS TO A NAMED STEP (autopsy 303e8a6f, 2026-10-12).
 *
 * That build waited 11.4 s before its first model call; the SETUP_TIMING lines accounted for 4.4 s of it. The
 * other 7 s (62%) sat in six stretches no line covered — git init as three serial sandbox round trips, two full
 * vault reads, an entitlement probe for services the user did not have, two reads of one Firestore document —
 * each added by a feature that put one more `await` between two hand-placed timing lines. Three earlier autopsies
 * each timed the ONE window they were pointed at, and the next one found the next void.
 *
 * So the window is the unit, not the step: `BuildDiagnostics.closeSetupWindow` starts each window exactly where
 * the last timed span ended, which makes the windows contiguous by construction — an await nobody wrapped shows up
 * as `other Nms` in its window instead of vanishing. This module only names what happened inside one. PURE (the
 * clock is injectable).
 */

export interface PrepStep { name: string; ms: number }

export interface PrepSteps {
  /** Time `run`, record it under `name`, and return its result (or rethrow). */
  step<T>(name: string, run: () => Promise<T> | T): Promise<T>;
  /** What has been timed so far, in order. */
  list(): PrepStep[];
}

export function createPrepSteps(now: () => number = Date.now): PrepSteps {
  const steps: PrepStep[] = [];
  return {
    async step<T>(name: string, run: () => Promise<T> | T): Promise<T> {
      const t0 = now();
      try {
        return await run();
      } finally {
        steps.push({ name, ms: Math.max(0, now() - t0) });
      }
    },
    list: () => steps.map((s) => ({ ...s })),
  };
}

/** `git init 820ms · vault 120ms · other 340ms` — the steps that took time, then what no step claims. PURE. */
export function prepWindowDetail(steps: readonly PrepStep[], wallMs: number): string {
  const timed = steps.filter((s) => s.ms > 0);
  const sum = timed.reduce((a, s) => a + s.ms, 0);
  const other = Math.max(0, Math.round(wallMs - sum));
  const parts = timed.map((s) => `${s.name} ${Math.round(s.ms)}ms`);
  parts.push(`other ${other}ms`);
  return parts.join(' · ');
}
