import { describe, it, expect } from 'vitest';
import {
  initialFutilityState,
  armedFutilityState,
  resetFutilityQuiet,
  tickFutility,
  futilityStopApplies,
  futilityMinutes,
} from './futilityBreaker';

describe('resetFutilityQuiet — truncation recovery must not die on the quiet streak (autopsy bd20f9b2)', () => {
  it('clears quietTicks but keeps the progress baseline', () => {
    let state = armedFutilityState({ filesWritten: 1, commandsRun: 1, stepsDone: 1, pathsRead: 2 });
    // Fill the quiet window with no further progress.
    for (let i = 0; i < 10; i++) {
      const v = tickFutility(state, { filesWritten: 1, commandsRun: 1, stepsDone: 1, pathsRead: 2 }, 10);
      state = v.state;
      if (i < 9) expect(v.stop).toBe(false);
      else expect(v.stop).toBe(true);
    }
    expect(state.quietTicks).toBe(10);

    state = resetFutilityQuiet(state);
    expect(state.quietTicks).toBe(0);
    expect(state.last).toEqual({ filesWritten: 1, commandsRun: 1, stepsDone: 1, pathsRead: 2 });

    // Recovery gets a fresh window — one quiet tick does not stop.
    const after = tickFutility(state, { filesWritten: 1, commandsRun: 1, stepsDone: 1, pathsRead: 2 }, 10);
    expect(after.stop).toBe(false);
    expect(after.state.quietTicks).toBe(1);
  });

  it('a real write after reset still clears the new quiet streak', () => {
    let state = resetFutilityQuiet(
      tickFutility(
        armedFutilityState({ filesWritten: 1, commandsRun: 0, stepsDone: 0, pathsRead: 0 }),
        { filesWritten: 1, commandsRun: 0, stepsDone: 0, pathsRead: 0 },
        10,
      ).state,
    );
    // two quiet minutes…
    state = tickFutility(state, { filesWritten: 1, commandsRun: 0, stepsDone: 0, pathsRead: 0 }, 10).state;
    state = tickFutility(state, { filesWritten: 1, commandsRun: 0, stepsDone: 0, pathsRead: 0 }, 10).state;
    expect(state.quietTicks).toBe(2);
    // …then the rewrite lands.
    const v = tickFutility(state, { filesWritten: 2, commandsRun: 0, stepsDone: 0, pathsRead: 0 }, 10);
    expect(v.stop).toBe(false);
    expect(v.state.quietTicks).toBe(0);
  });
});

describe('futilityStopApplies', () => {
  it('does not stop a build that already rendered', () => {
    // limit=1 → the first quiet tick is already a stop.
    const stop = tickFutility(
      armedFutilityState({ filesWritten: 0, commandsRun: 0, stepsDone: 0 }),
      { filesWritten: 0, commandsRun: 0, stepsDone: 0 },
      1,
    );
    expect(stop.stop).toBe(true);
    expect(futilityStopApplies(stop, { appRendered: true })).toBe(false);
    expect(futilityStopApplies(stop, { appRendered: false })).toBe(true);
  });
});

describe('futilityMinutes', () => {
  it('honours explicit 0 / off and clamps the window', () => {
    expect(futilityMinutes({ AGENTV3_FUTILITY_MINUTES: '0' } as NodeJS.ProcessEnv)).toBe(0);
    expect(futilityMinutes({ AGENTV3_FUTILITY_MINUTES: 'off' } as NodeJS.ProcessEnv)).toBe(0);
    expect(futilityMinutes({ AGENTV3_FUTILITY_MINUTES: '3' } as NodeJS.ProcessEnv)).toBe(6); // floor
    expect(futilityMinutes({ AGENTV3_FUTILITY_MINUTES: '99' } as NodeJS.ProcessEnv)).toBe(30); // ceiling
  });
});

describe('initialFutilityState', () => {
  it('starts at zero', () => {
    expect(initialFutilityState()).toEqual({
      last: { filesWritten: 0, commandsRun: 0, stepsDone: 0, pathsRead: 0 },
      quietTicks: 0,
    });
  });
});
