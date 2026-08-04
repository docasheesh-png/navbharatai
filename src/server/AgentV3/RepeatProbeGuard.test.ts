import { describe, it, expect } from 'vitest';
import {
  newRepeatProbeState, probeSignature, recordAndCheckRepeat, collectRepeatProbeSteer,
  loopGuardEnabled, loopGuardThreshold, repeatProbeSteer,
} from './RepeatProbeGuard';

// Autopsy 2026-07-21: a weak build ran the SAME `grep "from '../types'"` ~6 times (each empty) and never
// converged (ok:None). The loop breaker steers the model off a repeated non-progressing call.

describe('probeSignature — stable, key-order independent', () => {
  it('same tool + same input (any key order) → same signature', () => {
    const a = probeSignature('run_command', { command: 'grep x', cwd: '.' });
    const b = probeSignature('run_command', { cwd: '.', command: 'grep x' });
    expect(a).toBe(b);
  });
  it('different input → different signature', () => {
    expect(probeSignature('run_command', { command: 'grep x' }))
      .not.toBe(probeSignature('run_command', { command: 'grep y' }));
  });
  it('caps a huge string body but keeps it distinct', () => {
    const big1 = probeSignature('write_file', { path: 'a', content: 'A'.repeat(5000) });
    const big2 = probeSignature('write_file', { path: 'a', content: 'B'.repeat(5000) });
    expect(big1).not.toBe(big2);
    expect(big1.length).toBeLessThan(400); // bounded
  });
});

describe('recordAndCheckRepeat — steers exactly once at the threshold', () => {
  it('null before the threshold, steer AT the 3rd identical call, null after (steered once)', () => {
    const st = newRepeatProbeState();
    const call = () => recordAndCheckRepeat(st, 'run_command', { command: "grep -rn \"from '../types'\" src/" }, 3);
    expect(call()).toBeNull();       // 1st
    expect(call()).toBeNull();       // 2nd
    const s = call();                // 3rd → trips
    expect(s).toMatch(/LOOP GUARD/);
    expect(s).toMatch(/run_command/);
    expect(call()).toBeNull();       // 4th → already steered, silent
  });

  it('distinct calls are counted independently (no false loop)', () => {
    const st = newRepeatProbeState();
    for (let i = 0; i < 5; i++) {
      expect(recordAndCheckRepeat(st, 'read_file', { path: `src/f${i}.ts` }, 3)).toBeNull();
    }
  });

  it('honours a custom threshold', () => {
    const st = newRepeatProbeState();
    const call = () => recordAndCheckRepeat(st, 'grep', { q: 'x' }, 2);
    expect(call()).toBeNull();
    expect(call()).toMatch(/LOOP GUARD/); // 2nd trips at threshold 2
  });
});

describe('collectRepeatProbeSteer — one combined steer for a turn', () => {
  it('fires when a turn repeats a call that already ran twice before', () => {
    const st = newRepeatProbeState();
    const input = { command: 'grep phantom' };
    recordAndCheckRepeat(st, 'run_command', input, 3); // 1
    recordAndCheckRepeat(st, 'run_command', input, 3); // 2
    const steer = collectRepeatProbeSteer(st, [{ name: 'run_command', input }], 3); // 3rd → trips
    expect(steer).toMatch(/LOOP GUARD/);
  });

  it('returns null for a turn with only fresh calls', () => {
    const st = newRepeatProbeState();
    const steer = collectRepeatProbeSteer(st, [{ name: 'write_file', input: { path: 'a', content: 'x' } }], 3);
    expect(steer).toBeNull();
  });

  it('never throws on malformed tool uses', () => {
    const st = newRepeatProbeState();
    expect(() => collectRepeatProbeSteer(st, [{ name: undefined, input: undefined }, {} as never], 3)).not.toThrow();
  });
});

describe('flags', () => {
  it('loop guard defaults ON, off disables', () => {
    expect(loopGuardEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(loopGuardEnabled({ AGENTV3_LOOP_GUARD: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
  it('threshold defaults to 3, env-tunable, floored at 2', () => {
    expect(loopGuardThreshold({} as NodeJS.ProcessEnv)).toBe(3);
    expect(loopGuardThreshold({ AGENTV3_LOOP_GUARD_THRESHOLD: '5' } as unknown as NodeJS.ProcessEnv)).toBe(5);
    expect(loopGuardThreshold({ AGENTV3_LOOP_GUARD_THRESHOLD: '1' } as unknown as NodeJS.ProcessEnv)).toBe(3); // below min → default
  });
});

describe('escalating loop breaker (autopsy 2026-08-02: one nudge at min 13, then silence to min 30+)', () => {
  it('re-steers at DOUBLING counts instead of going permanently silent after the first nudge', () => {
    const st = newRepeatProbeState();
    const call = () => recordAndCheckRepeat(st, 'grep', { q: "from '../types'" }, 3);
    const steeredAt: number[] = [];
    for (let i = 1; i <= 13; i++) if (call()) steeredAt.push(i);
    // Before the fix this was [3] and the guard never spoke again, however long the loop ran.
    expect(steeredAt).toEqual([3, 6, 12]);
  });

  it('stays SPARSE — the 4th and 5th identical calls are still silent (no per-turn spam)', () => {
    const st = newRepeatProbeState();
    const call = () => recordAndCheckRepeat(st, 'grep', { q: 'x' }, 3);
    call(); call();
    expect(call()).not.toBeNull(); // 3rd — first nudge
    expect(call()).toBeNull();     // 4th
    expect(call()).toBeNull();     // 5th
    expect(call()).not.toBeNull(); // 6th — escalated
  });

  it('the escalated steer is FIRMER and honest: banned call + finish with what you have', () => {
    const first = repeatProbeSteer('grep', 3, 3);
    const later = repeatProbeSteer('grep', 6, 3);
    expect(first).toContain('[LOOP GUARD]');
    expect(first).not.toContain('FINAL');
    expect(later).toContain('[LOOP GUARD — FINAL]');
    expect(later).toContain('banned for the rest of this build');
    expect(later).toContain('do not loop');
    expect(later).not.toBe(first);
  });

  it('each signature escalates INDEPENDENTLY (one loop never mutes another)', () => {
    const st = newRepeatProbeState();
    for (let i = 0; i < 3; i++) recordAndCheckRepeat(st, 'grep', { q: 'a' }, 3);
    // A different call is still nudged on ITS own 3rd repeat.
    let steer: string | null = null;
    for (let i = 0; i < 3; i++) steer = recordAndCheckRepeat(st, 'grep', { q: 'b' }, 3);
    expect(steer).not.toBeNull();
  });
});

