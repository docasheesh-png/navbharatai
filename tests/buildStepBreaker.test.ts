import { describe, it, expect, beforeEach } from 'vitest';
import {
  getStepBreaker, runWithBreaker, resetStepBreakers, allStepBreakerNames, CircuitOpenError,
} from '../src/server/AppMakerLab/BuildStepBreaker';

/**
 * P-BRE.9 — per-engine build-step circuit breaker.
 */
beforeEach(() => resetStepBreakers());

describe('BuildStepBreaker — registry', () => {
  it('lazily creates one breaker per step and reuses it', () => {
    const a = getStepBreaker('engine:frontend');
    const b = getStepBreaker('engine:frontend');
    expect(a).toBe(b);
    getStepBreaker('engine:backend');
    expect(allStepBreakerNames().sort()).toEqual(['engine:backend', 'engine:frontend']);
  });
});

describe('BuildStepBreaker — runWithBreaker', () => {
  it('returns the result and keeps the breaker closed on success', async () => {
    const out = await runWithBreaker('engine:x', async () => 42);
    expect(out).toBe(42);
    expect(getStepBreaker('engine:x').state()).toBe('closed');
  });

  it('rethrows the original error on failure (and records it)', async () => {
    await expect(runWithBreaker('engine:x', async () => { throw new Error('boom'); }))
      .rejects.toThrow('boom');
    expect(getStepBreaker('engine:x').snapshot().consecutiveFailures).toBe(1);
  });

  it('opens after 3 failures and then FAST-FAILS with CircuitOpenError', async () => {
    const fail = () => runWithBreaker('engine:x', async () => { throw new Error('boom'); });
    await expect(fail()).rejects.toThrow('boom');
    await expect(fail()).rejects.toThrow('boom');
    await expect(fail()).rejects.toThrow('boom'); // 3rd failure → escalated cooldown, now blocking

    expect(getStepBreaker('engine:x').isBlocking()).toBe(true);
    // Next call must NOT execute fn — it fast-fails.
    let ran = false;
    await expect(
      runWithBreaker('engine:x', async () => { ran = true; return 1; }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(ran).toBe(false);
  });

  it('invokes onOpen when the breaker trips and when it fast-fails', async () => {
    const opens: string[] = [];
    const onOpen = (i: { step: string }) => opens.push(i.step);
    const fail = () => runWithBreaker('engine:y', async () => { throw new Error('x'); }, onOpen);
    await expect(fail()).rejects.toThrow();
    await expect(fail()).rejects.toThrow();
    await expect(fail()).rejects.toThrow(); // tips open → onOpen fires
    await expect(runWithBreaker('engine:y', async () => 1, onOpen)).rejects.toBeInstanceOf(CircuitOpenError); // fast-fail → onOpen fires
    expect(opens.length).toBeGreaterThanOrEqual(2);
    expect(opens.every((s) => s === 'engine:y')).toBe(true);
  });

  it('a success closes the breaker and resets the failure streak', async () => {
    await expect(runWithBreaker('engine:z', async () => { throw new Error('e'); })).rejects.toThrow();
    await runWithBreaker('engine:z', async () => 'ok');
    expect(getStepBreaker('engine:z').state()).toBe('closed');
    expect(getStepBreaker('engine:z').snapshot().consecutiveFailures).toBe(0);
  });
});
