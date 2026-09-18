/**
 * THE DONE SIGNAL — the engine computed "this app is finished" and threw the answer away.
 *
 * `assessBuildReadiness` already runs inside the build loop and returns score, blockers and `ready`.
 * `weakCheckpointSteer` read only the blockers, so the FINISHED verdict reached nothing and was
 * recorded nowhere. These cases pin the measurement (the deliverable), the steer (the cheap half), and
 * the bar that keeps the steer from firing on a mediocre app.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  doneSignalConfig, shouldCheckDone, appIsDone, doneSteer, readyOverrunNote, DONE_SCORE,
} from '../src/server/AgentV3/doneSignal';
import { MIN_READY_SCORE, type ReadinessReport } from '../src/server/AgentV3/Readiness';

const report = (over: Partial<ReadinessReport> = {}): ReadinessReport => ({
  score: 92, ready: true, blockers: [], warnings: [], tier: 'production', ...over,
});

describe('the bar for "you may stop" is higher than the bar for "nothing is blocking"', () => {
  it('DONE_SCORE sits well above MIN_READY_SCORE', () => {
    // `ready` answers "is anything blocking?" and its floor is deliberately low so a working app is
    // never condemned. Telling a model to walk away is a stronger claim and needs a stronger number.
    expect(DONE_SCORE).toBeGreaterThan(MIN_READY_SCORE);
    expect(MIN_READY_SCORE).toBe(50);
    expect(DONE_SCORE).toBe(85);
  });

  it('a build that merely passes the gate is NOT done', () => {
    expect(appIsDone(report({ score: 60 }))).toBe(false);
    expect(doneSteer(report({ score: 60 }))).toBeNull();
  });

  it('a healthy, unblocked app IS done', () => {
    expect(appIsDone(report())).toBe(true);
    expect(doneSteer(report())).toContain('complete and healthy');
  });

  it.each([
    ['not ready', report({ ready: false })],
    ['a blocker present', report({ blockers: ['unresolved import'] })],
    ['a NaN score', report({ score: Number.NaN })],
  ])('never fires with %s', (_label, r) => {
    expect(appIsDone(r)).toBe(false);
  });

  it('a missing report is not a finished app', () => {
    expect(appIsDone(null)).toBe(false);
    expect(appIsDone(undefined)).toBe(false);
    expect(doneSteer(null)).toBeNull();
  });
});

describe('the steer states its evidence and lets the model disagree', () => {
  const text = doneSteer(report({ score: 92 })) as string;

  it('names the measure rather than issuing a bare order', () => {
    expect(text).toContain('92/100');
    expect(text).toContain('no blockers');
  });

  it('tells the model to override it when something requested is genuinely missing', () => {
    // An engine check cannot know what the user asked for. A steer that did not say so would push a
    // model to abandon a half-built feature — the opposite of the aim.
    expect(text).toMatch(/ignore this/i);
    expect(text).toMatch(/cannot know what was requested/i);
  });

  it('forbids exactly the behaviour that wastes the clock', () => {
    expect(text).toMatch(/do not add polish, refactors or extra features/i);
  });
});

describe('it fires once, and never before there is an app', () => {
  const cfg = doneSignalConfig({} as NodeJS.ProcessEnv);

  it('is silent once it has already spoken', () => {
    // A model told it may stop and still going has decided otherwise; repeating would be nagging.
    expect(shouldCheckDone({ cfg, step: 20, toolUses: 5, alreadySignalled: true })).toBe(false);
  });

  it.each([
    ['nothing written yet', { step: 20, toolUses: 0 }],
    ['still warming up', { step: 2, toolUses: 5 }],
    ['not on the cadence', { step: 13, toolUses: 5 }],
  ])('is silent when %s', (_l, p) => {
    expect(shouldCheckDone({ cfg, ...p, alreadySignalled: false })).toBe(false);
  });

  it('runs on the cadence once real work exists', () => {
    expect(shouldCheckDone({ cfg, step: 20, toolUses: 5, alreadySignalled: false })).toBe(true);
  });

  it('off means off', () => {
    const off = doneSignalConfig({ AGENTV3_DONE_SIGNAL: 'off' } as unknown as NodeJS.ProcessEnv);
    expect(off.enabled).toBe(false);
    expect(shouldCheckDone({ cfg: off, step: 20, toolUses: 5, alreadySignalled: false })).toBe(false);
  });

  it('a blank or malformed tunable falls back to its default, never to zero', () => {
    // `parseInt('')` is NaN and `Number('')` is 0 — a cleared Cloud Run field must not mean "every step".
    const blank = doneSignalConfig({ AGENTV3_DONE_SIGNAL_EVERY: '', AGENTV3_DONE_SIGNAL_MIN_STEP: '  ' } as unknown as NodeJS.ProcessEnv);
    expect(blank.everyN).toBe(10);
    expect(blank.minStep).toBe(8);
    expect(blank.enabled).toBe(true);
  });
});

describe('the measurement — the deliverable, and it never reads as zero when it is unknown', () => {
  it('"never judged finished" is said in words, not as an overrun of zero', () => {
    expect(readyOverrunNote(null, 40, 600_000)).toBe('The app was never judged finished during the build.');
  });

  it('a build that stopped when it was done says so', () => {
    expect(readyOverrunNote({ step: 20, elapsedMs: 300_000, score: 90 }, 20, 300_000))
      .toContain('the build ended there');
  });

  it('an overrun is reported in steps AND seconds', () => {
    const note = readyOverrunNote({ step: 20, elapsedMs: 300_000, score: 90 }, 46, 1_860_000);
    expect(note).toContain('26 more step(s)');
    expect(note).toContain('1560s');
    expect(note).toContain('90/100');
  });

  it('a clock that runs backwards cannot produce a negative overrun', () => {
    expect(readyOverrunNote({ step: 30, elapsedMs: 900_000, score: 90 }, 10, 100_000))
      .toContain('the build ended there');
  });
});

describe('WIRING — the check runs in the loop and the number reaches the report', () => {
  const strip = (f: string) => readFileSync(resolve(__dirname, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  const runner = strip('../src/server/AgentV3/AgentRunner.ts');
  const route = strip('../src/server/routes/agentv3.ts');

  it('the runner asks the same free readiness scan the weak checkpoint already uses', () => {
    expect(runner).toContain('shouldCheckDone({ cfg: doneCfg');
    expect(runner).toContain('const readiness = await dispatcher.assessBuildReadiness();');
    expect(runner).toContain('doneText = doneSteer(readiness);');
  });

  it('the steer is appended to the SAME message the other steers ride', () => {
    // A steer computed and never attached is the decoration this repo has shipped before.
    expect(runner).toContain("const steer = [truncationSteer, loopSteer, budgetText, doneText].filter(Boolean)");
  });

  it('the mark is recorded even when the model keeps building', () => {
    expect(runner).toContain('if (!readyMark) readyMark = {');
    expect(runner).toContain('readyAt: readyMark');
  });

  it('the route records READY_BEFORE_END on every build', () => {
    expect(route).toContain("code: 'READY_BEFORE_END'");
    expect(route).toContain('readyOverrunNote(result.readyAt, result.steps');
  });
});
