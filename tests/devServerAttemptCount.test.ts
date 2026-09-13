/**
 * Autopsy f04421ef, part 3 — a message must not state a count its author cannot know.
 *
 * `classifyDevServerFailure` is a PURE function of the dev-server log. It has no idea which attempt it
 * is on or how many remain — and one of its strings said "restarting once". The caller allows TWO
 * recovery attempts (`MAX_RECOVERY = 2` in E2BActuator), so that line could print twice and contradict
 * itself the second time.
 *
 * Fixing the one string would be the surface patch. The class of bug is "the count lives where the
 * count is not known", so the count moved to `planDevServerRecovery`, which actually holds it.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyDevServerFailure,
  planDevServerRecovery,
  attemptSuffix,
} from '../src/server/AgentV3/sandbox/EngineerAI/actuators/DevServerRecovery';

const UNKNOWN_LOG = 'some output that means nothing in particular\n';

describe('the classifier never names a retry count', () => {
  it('THE BUG: the unrecognised-log diagnosis no longer claims "once"', () => {
    const d = classifyDevServerFailure(UNKNOWN_LOG);
    expect(d.cause).toBe('unknown');
    expect(d.detail).toMatch(/restarting/);
    expect(d.detail).not.toMatch(/once/i);
  });

  it('no classifier message anywhere promises a specific number of attempts', () => {
    const logs = [
      UNKNOWN_LOG,
      'Error: something exploded\n',
      'JavaScript heap out of memory\n',
      'EADDRINUSE: address already in use :::5173\n',
      "Cannot find module 'left-pad'\n",
    ];
    for (const log of logs) {
      const d = classifyDevServerFailure(log);
      expect(d.detail, `cause=${d.cause}`).not.toMatch(/\bonce\b|\btwice\b|\bone more\b/i);
    }
  });
});

describe('planDevServerRecovery states the REAL position in the budget', () => {
  it('a retry carries its true attempt number', () => {
    expect(planDevServerRecovery(UNKNOWN_LOG, 1, 3).detail).toMatch(/\(attempt 1 of 3\)/);
    expect(planDevServerRecovery(UNKNOWN_LOG, 2, 3).detail).toMatch(/\(attempt 2 of 3\)/);
  });

  it('two successive attempts never print the same sentence — the thing "once" got wrong', () => {
    const first = planDevServerRecovery(UNKNOWN_LOG, 1, 3).detail;
    const second = planDevServerRecovery(UNKNOWN_LOG, 2, 3).detail;
    expect(first).not.toBe(second);
  });

  it('the FINAL attempt gives up honestly and does NOT promise another restart', () => {
    const d = planDevServerRecovery(UNKNOWN_LOG, 2, 2);
    expect(d.recovery).toBe('give_up');
    expect(d.detail).toMatch(/Automatic recovery is exhausted/);
    expect(d.detail).not.toMatch(/restarting/i);
    expect(d.detail).not.toMatch(/\(attempt \d+ of/);
  });

  it('a code_fix short-circuits with its actionable detail intact and no attempt counter', () => {
    const log = 'SyntaxError: Unexpected token in src/App.tsx\n';
    const d = planDevServerRecovery(log, 1, 2);
    expect(d.recovery).toBe('code_fix');
    expect(d.detail).not.toMatch(/\(attempt \d+ of/);
    // The detail a code fix needs must survive untouched.
    expect(d.detail).toMatch(/SyntaxError/);
  });
});

describe('attemptSuffix — clamped, so a nonsense argument cannot produce a nonsense promise', () => {
  it('formats the ordinary case', () => {
    expect(attemptSuffix(1, 2)).toBe('(attempt 1 of 2)');
  });

  it('never reports an attempt beyond the budget', () => {
    expect(attemptSuffix(9, 2)).toBe('(attempt 2 of 2)');
  });

  it('never reports attempt zero or a negative budget', () => {
    expect(attemptSuffix(0, 2)).toBe('(attempt 1 of 2)');
    expect(attemptSuffix(1, 0)).toBe('(attempt 1 of 1)');
    expect(attemptSuffix(-5, -5)).toBe('(attempt 1 of 1)');
  });

  it('non-numeric input degrades to the safest true statement, never to NaN', () => {
    expect(attemptSuffix(Number.NaN, Number.NaN)).toBe('(attempt 1 of 1)');
    expect(attemptSuffix(1.7, 2.9)).toBe('(attempt 1 of 2)');
  });
});
