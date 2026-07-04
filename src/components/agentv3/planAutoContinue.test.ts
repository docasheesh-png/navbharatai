// SPM-3 — the auto-continue decision. These encode the two failure modes the guard exists for:
// an infinite continue loop (plan not advancing) and a mega-plan being strangled by the classic
// 2-continue budget that was designed for wall-clock pauses.

import { describe, it, expect } from 'vitest';
import { decideAutoContinue, PAUSE_CONTINUE_MAX, PLAN_CONTINUE_MAX } from './planAutoContinue';

describe('decideAutoContinue — classic (no plan signal)', () => {
  it('continues a deadline pause within the pause budget', () => {
    const d = decideAutoContinue({ planRemaining: undefined, lastPlanRemaining: null, pauseContinues: 0, planContinues: 0 });
    expect(d).toEqual({ proceed: true, resetPauseBudget: false, isPlanContinue: false });
  });

  it('stops honestly once the pause budget is spent', () => {
    const d = decideAutoContinue({ planRemaining: null, lastPlanRemaining: null, pauseContinues: PAUSE_CONTINUE_MAX, planContinues: 0 });
    expect(d.proceed).toBe(false);
    expect(d.stopMessage).toContain('continue');
  });
});

describe('decideAutoContinue — project mode', () => {
  it('continues while the plan strictly advances, resetting the pause budget each module', () => {
    const first = decideAutoContinue({ planRemaining: 40, lastPlanRemaining: null, pauseContinues: 0, planContinues: 0 });
    expect(first.proceed).toBe(true);
    expect(first.resetPauseBudget).toBe(true);
    expect(first.isPlanContinue).toBe(true);
    const later = decideAutoContinue({ planRemaining: 39, lastPlanRemaining: 40, pauseContinues: 0, planContinues: 1 });
    expect(later.proceed).toBe(true);
  });

  it('a mega-plan runs FAR past the classic budget while progressing (the whole point)', () => {
    // Module 30 of 40: pauseContinues freshly reset, planContinues 30 — still proceeds.
    const d = decideAutoContinue({ planRemaining: 10, lastPlanRemaining: 11, pauseContinues: 0, planContinues: 30 });
    expect(d.proceed).toBe(true);
  });

  it('stops when the plan is NOT advancing (loop guard)', () => {
    const stalled = decideAutoContinue({ planRemaining: 12, lastPlanRemaining: 12, pauseContinues: 0, planContinues: 5 });
    expect(stalled.proceed).toBe(false);
    expect(stalled.stopMessage).toContain('not advancing');
    // remaining somehow INCREASED (e.g. a retry re-opened a module) → also a stop, never a loop.
    const grew = decideAutoContinue({ planRemaining: 13, lastPlanRemaining: 12, pauseContinues: 0, planContinues: 5 });
    expect(grew.proceed).toBe(false);
  });

  it('first plan result of a chain always proceeds (no previous value to compare)', () => {
    const d = decideAutoContinue({ planRemaining: 60, lastPlanRemaining: null, pauseContinues: 0, planContinues: 0 });
    expect(d.proceed).toBe(true);
  });

  it('stops at the absolute session backstop', () => {
    const d = decideAutoContinue({ planRemaining: 3, lastPlanRemaining: 4, pauseContinues: 0, planContinues: PLAN_CONTINUE_MAX });
    expect(d.proceed).toBe(false);
    expect(d.stopMessage).toContain('checkpoint');
  });

  it('a mid-module deadline pause uses the pause budget, refreshed by the previous module progress', () => {
    // Module completed → resetPauseBudget true (verified above). A pause inside the NEXT module:
    const pause = decideAutoContinue({ planRemaining: undefined, lastPlanRemaining: 39, pauseContinues: 1, planContinues: 7 });
    expect(pause.proceed).toBe(true);
    expect(pause.isPlanContinue).toBe(false);
  });
});
