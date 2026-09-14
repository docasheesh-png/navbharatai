import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  measuredRemainingFromSteps, observedPerStepMs, stepEtaText,
  measuredRemainingMs, MIN_STEPS_FOR_MEASUREMENT, FINISH_ALLOWANCE_MS,
} from '../src/server/AgentV3/progressEta';

const MIN = 60_000;
const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

/**
 * AUTOPSY d11ad529 (2026-09-14) — "Text to image generator app banao asli ."
 *
 * Free/weak tier, 12m02s, ok:false. The fast lane's plan call hit its 90 s cap and the lane handed
 * off to the full builder, which built a working app (tsc clean, npm run build exit 0, preview
 * verified rendering, PROD_BUILD_OK). What the user actually READ for those twelve minutes was:
 *
 *   0.1s  "Estimated build time: ~2–4 min — this is a first guess … I'll replace it with a real
 *          figure as soon as I know how big it is."
 *   2min  "~53s to go"
 *   4min  "bigger than expected — about 3 min more to go"
 *   6/10/12min  "bigger than estimated, still working"
 *
 * Not one of those is the MEASURED line, because `plannedFiles` never left 0: its only producers are
 * the simple lane (whose plan call died) and the blueprint (gated off for an ordinary app). The
 * promise in the first line was unkeepable on that path by construction.
 */
describe('the measured ETA must work on the path the user waits on', () => {
  it('THE BUG: with no file plan, the file measurement is null however long the build runs', () => {
    // Exactly the reported build: a plan that never arrived, twelve minutes of real progress.
    for (const elapsed of [2 * MIN, 4 * MIN, 8 * MIN, 12 * MIN]) {
      expect(measuredRemainingMs({
        plannedFiles: 0, filesDone: 9, firstFileAt: 1_000, now: 1_000 + elapsed,
      })).toBeNull();
    }
  });

  it('THE FIX: the architect\'s own plan measures the same build', () => {
    // 8-step plan, 4 done, one step per minute since the first landed at t=1min.
    const remaining = measuredRemainingFromSteps({
      plannedSteps: 8, stepsDone: 4, firstStepAt: 1 * MIN, now: 4 * MIN,
    });
    expect(remaining).not.toBeNull();
    // 3 intervals over 3 minutes = 1 min/step; 4 steps left + the finish allowance.
    expect(remaining).toBe(4 * MIN + FINISH_ALLOWANCE_MS);
  });

  it('names what it counted, so the number is checkable against the ticks on screen', () => {
    const text = stepEtaText(4 * MIN, 5 * MIN, 4, 8);
    expect(text).toContain('4 of 8 steps done');
    expect(text).toContain('4 min in');
    // Never claims files — the plan's unit is a step, and saying "files" would be a different claim.
    expect(text).not.toMatch(/files?\b/i);
  });
});

describe('null rather than a guess — the discipline the file measurement already had', () => {
  it('refuses to extrapolate before there are two real intervals', () => {
    for (let done = 0; done < MIN_STEPS_FOR_MEASUREMENT; done += 1) {
      expect(observedPerStepMs({ plannedSteps: 8, stepsDone: done, firstStepAt: 1_000, now: 500_000 })).toBeNull();
      expect(measuredRemainingFromSteps({ plannedSteps: 8, stepsDone: done, firstStepAt: 1_000, now: 500_000 })).toBeNull();
    }
    expect(observedPerStepMs({ plannedSteps: 8, stepsDone: 3, firstStepAt: 1_000, now: 500_000 })).not.toBeNull();
  });

  it('a one-step plan is not a measurement', () => {
    expect(measuredRemainingFromSteps({ plannedSteps: 1, stepsDone: 3, firstStepAt: 1_000, now: 500_000 })).toBeNull();
    expect(measuredRemainingFromSteps({ plannedSteps: 0, stepsDone: 5, firstStepAt: 1_000, now: 500_000 })).toBeNull();
  });

  it('🔴 a plan the build has already OUTGROWN yields null, never zero and never a negative', () => {
    // `stepsDone` counts real completions and is not clamped to the plan, so it runs past a plan that
    // under-counted the work. "The plan was too small" is not "there is no time left" — and a zero
    // here would print "~0s to go" on a build with minutes left, which is the class of lie this whole
    // module exists to end.
    for (const done of [8, 9, 40]) {
      expect(measuredRemainingFromSteps({ plannedSteps: 8, stepsDone: done, firstStepAt: 1_000, now: 500_000 })).toBeNull();
    }
  });

  it('rejects a missing or impossible clock instead of inventing an interval', () => {
    expect(measuredRemainingFromSteps({ plannedSteps: 8, stepsDone: 4, firstStepAt: 0, now: 500_000 })).toBeNull();
    expect(measuredRemainingFromSteps({ plannedSteps: 8, stepsDone: 4, firstStepAt: 500_000, now: 500_000 })).toBeNull();
    expect(measuredRemainingFromSteps({ plannedSteps: 8, stepsDone: 4, firstStepAt: 900_000, now: 500_000 })).toBeNull();
    expect(measuredRemainingFromSteps({} as never)).toBeNull();
  });

  it('does not credit an interval that never happened (the optimistic direction of the original bug)', () => {
    // 4 steps done, first at t=1min, now t=4min → 3 intervals, so 1 min/step. Dividing by 4 would
    // say 45s/step and under-state everything left — how an ETA becomes a broken promise.
    // (firstStepAt must be > 0: zero means 'never stamped', and that is a null, not an epoch.)
    expect(observedPerStepMs({ plannedSteps: 8, stepsDone: 4, firstStepAt: 1 * MIN, now: 4 * MIN })).toBe(1 * MIN);
  });

  it('a slower build produces a LARGER remaining estimate — it tracks reality, not a constant', () => {
    const fast = measuredRemainingFromSteps({ plannedSteps: 10, stepsDone: 4, firstStepAt: 1 * MIN, now: 4 * MIN })!;
    const slow = measuredRemainingFromSteps({ plannedSteps: 10, stepsDone: 4, firstStepAt: 1 * MIN, now: 10 * MIN })!;
    expect(slow).toBeGreaterThan(fast);
  });
});

describe('the wiring — every piece of which fails NOTHING if dropped', () => {
  // None of this can break a build, a typecheck or any other test: losing a line here simply returns
  // the ETA to guessing, silently, which is exactly how the 2026-08-23 fix came to be unreachable for
  // three weeks without one failure anywhere.
  it('the producer sits with the plan-progress recompute, fed by the SAME counter', () => {
    const at = route.indexOf('computePlanProgress(cur, planSteps, false)');
    expect(at).toBeGreaterThan(-1);
    const near = route.slice(at, at + 500);
    expect(near).toContain('noteEtaPlanStep(cur.length, planSteps)');
  });

  it('the heartbeat consumes it, and only AFTER the exact file measurement', () => {
    const file = route.indexOf('measuredRemainingMs({ plannedFiles');
    const step = route.indexOf('measuredRemainingFromSteps({ plannedSteps');
    expect(file).toBeGreaterThan(-1);
    expect(step).toBeGreaterThan(-1);
    // A file manifest is an exact count of what will be written; a plan step is a unit of the
    // architect's own choosing. Where both exist the file count is the better evidence, and keeping
    // it first is what makes this change a no-op for the lane that already worked.
    expect(file).toBeLessThan(step);
  });

  it('the step branch re-anchors the fallback budget, as the file branch does', () => {
    const at = route.indexOf('measuredRemainingFromSteps({ plannedSteps');
    const near = route.slice(at, at + 900);
    expect(near).toContain('etaTotalMs = elapsedMs + byStep');
    expect(near).toContain('stepEtaText(');
  });

  it('both counters only ever grow, so a shorter snapshot cannot walk the estimate backwards', () => {
    const at = route.indexOf('const noteEtaPlanStep');
    expect(at).toBeGreaterThan(-1);
    const body = route.slice(at, at + 600);
    expect(body).toContain('planLength > etaPlannedSteps');
    expect(body).toContain('stepsDone > etaStepsDone');
  });
});
