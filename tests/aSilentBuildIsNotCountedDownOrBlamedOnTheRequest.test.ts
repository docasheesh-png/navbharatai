import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { emptyWasteLedger, recordWaste, engineTimeDominated } from '../src/server/AgentV3/providerWaste';
import { abortSummary, timedOutSummary } from '../src/server/AgentV3/buildAbortCause';
import { etaTickLine, noWorkGraceMs, type EtaTickState } from '../src/server/AgentV3/progressEta';

/**
 * AUTOPSY 67a2b0a2 (2026-10-15) — a clear "data analyst portfolio" request on the Weak tier ran 10.1 min, wrote
 * NO file and was stopped by the futility breaker. Two things the user was told were not true:
 *
 *  1. "This build was not getting anywhere … Try again with a bit more detail about what the app should do." —
 *     for a five-part request. 315 s of the 604 s clock (52%) went to three model calls that answered nothing:
 *     the engine was slow, and the narration said so ("this one is on us") while the SUMMARY blamed the prompt.
 *     Three stories about one build — the b89ba6f8 class, met in a second ending.
 *  2. "~6 min to go" at minute 4, "~4" at 6, "~2" at 8 — a countdown from HISTORY ("23 recent builds averaged
 *     10 min") that this build's own silence had contradicted from the start.
 */

// The real figures from the report.
const REPORT_BUILD_MS = 603_861;
const reportLedger = () => {
  const l = emptyWasteLedger();
  recordWaste(l, 'GLM', 'silent', 15_007);
  recordWaste(l, 'KIMI', 'timeout', 150_011);
  recordWaste(l, 'GLM', 'timeout', 150_021);
  return l;
};

describe('ENGINE TIME vs THE REQUEST — one verdict, read from the build\'s own ledger', () => {
  it('the reported build (52% of its clock in calls that answered nothing) is the engine\'s doing', () => {
    expect(engineTimeDominated(reportLedger(), REPORT_BUILD_MS)).toBe(true);
  });
  it('a lone 15 s silent first rung in a 25 min build is NOT an outage (PAWTRACE 398db9f3: 15 s of 1,510 s)', () => {
    const l = emptyWasteLedger();
    recordWaste(l, 'GLM', 'silent', 15_007);
    expect(engineTimeDominated(l, 1_510_500)).toBe(false);
  });
  it('the boundary is a third of the clock; an unknown clock is never evidence of an outage', () => {
    const l = emptyWasteLedger();
    recordWaste(l, 'X', 'timeout', 100_000);
    expect(engineTimeDominated(l, 300_000)).toBe(true);
    expect(engineTimeDominated(l, 300_100)).toBe(false);
    expect(engineTimeDominated(l, 0)).toBe(false);
    expect(engineTimeDominated(l, Number.NaN)).toBe(false);
  });
});

describe('the ending never sends a person to "add detail" / "rephrase" when the engine was the cause', () => {
  const blames = /more detail|rephrase|try again with|smaller first step/i;
  it('futile: the three situations each say it was on us', () => {
    const nothing = abortSummary('futile', { builtSomething: false, providerFault: true });
    expect(nothing).toContain('this one is on us, not on your app');
    expect(nothing).not.toMatch(blames);
    const seeded = abortSummary('futile', { builtSomething: false, seed: 'platform-template', providerFault: true });
    expect(seeded).toContain('on us');
    expect(seeded).toContain('starting template');
    expect(seeded).not.toMatch(blames);
    const saved = abortSummary('futile', { builtSomething: true, providerFault: true });
    expect(saved).toContain('Your files so far are saved');
    expect(saved).not.toMatch(blames);
  });
  it('the wall-clock endings read the same fact', () => {
    expect(abortSummary('watchdog', { minutes: 25, builtSomething: false, providerFault: true })).toContain('on us');
    expect(timedOutSummary(25, { builtSomething: false, providerFault: true })).toContain('on us');
    expect(timedOutSummary(25, { builtSomething: false, providerFault: true })).not.toMatch(blames);
  });
  it('without the fact, today\'s wording is byte-for-byte what it was', () => {
    expect(abortSummary('futile', { builtSomething: false })).toBe('This build was not getting anywhere — nothing had been produced, so I stopped it instead of letting it run on. Nothing was lost. Try again with a bit more detail about what the app should do.');
    expect(abortSummary('futile', { builtSomething: false, providerFault: false })).toBe(abortSummary('futile', { builtSomething: false }));
  });
  it('a user\'s own Stop is never rewritten as an outage', () => {
    expect(abortSummary('user-stop', { builtSomething: false, providerFault: true })).toBe('Stopped, as you asked. Nothing had been written yet, so nothing was lost.');
  });
  it('White-Label: no vendor or model name', () => {
    const all = [abortSummary('futile', { providerFault: true }), abortSummary('futile', { builtSomething: true, providerFault: true }), timedOutSummary(25, { providerFault: true })].join(' ');
    expect(all).not.toMatch(/glm|kimi|nemotron|haiku|claude|anthropic|openai|gemini|model/i);
  });
});

describe('a countdown the build\'s own silence has contradicted is withdrawn', () => {
  const base: EtaTickState = {
    elapsedMs: 0, now: 0, finalChecks: false, appRenderedAt: 0, appExists: false,
    plannedFiles: 0, filesDone: 0, firstFileAt: 0, plannedSteps: 0, stepsDone: 0, firstStepAt: 0,
    evidenced: true, budgetMs: 1_500_000, roughBand: null, roughHighMs: null,
    totalMs: 502_533, baseMs: 502_533, revisions: 0, promisedHighMs: 585_203, // the report's promise: 7.8-9.8 min
  };
  const at = (min: number, over: Partial<EtaTickState> = {}) => etaTickLine({ ...base, elapsedMs: min * 60_000, now: min * 60_000, ...over });

  it('minute 4, 6 and 8 of the reported build: no "to go" — nothing written is said instead', () => {
    for (const m of [4, 6, 8]) {
      const d = at(m);
      expect(d.kind, `minute ${m}`).toBe('no-work-yet');
      expect(d.text).not.toMatch(/to go|left for this one/);
      expect(d.text).toContain('nothing has been written yet');
    }
  });
  it('before the grace a plan and a first file legitimately take, the history countdown stands', () => {
    expect(noWorkGraceMs(585_203)).toBeCloseTo(0.35 * 585_203, 0); // 205 s — more than the 3 min floor
    expect(noWorkGraceMs(60_000)).toBe(3 * 60_000);
    expect(at(2).kind).not.toBe('no-work-yet');
  });
  it('the grace grows with the promise (a long promised build gets longer before the line changes)', () => {
    expect(noWorkGraceMs(40 * 60_000)).toBe(14 * 60_000);
  });
  it('one written file or one finished step is evidence again — the measured line takes over', () => {
    // One file / one step already ends the "nothing written" claim (it would be false); the measured line needs
    // more observations before it prints a number, which is its own rule and is not changed here.
    expect(at(5, { filesDone: 1, plannedFiles: 8, firstFileAt: 4 * 60_000 }).kind).not.toBe('no-work-yet');
    expect(at(5, { stepsDone: 1, plannedSteps: 6, firstStepAt: 4 * 60_000 }).kind).not.toBe('no-work-yet');
    expect(at(6, { filesDone: 3, plannedFiles: 8, firstFileAt: 3 * 60_000 }).kind).toBe('measured-files');
  });
  it('an UNevidenced build keeps its own already-honest line', () => {
    expect(at(6, { evidenced: false }).kind).toBe('unevidenced');
  });
});

describe('🔒 wiring: the runner reads the verdict at BOTH endings, the route supplies it', () => {
  const runner = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('endingContext carries providerFault, and both summary sites spread endingContext', () => {
    expect(runner).toContain('providerFault = this.opts.providerFaultNow?.() === true');
    expect(runner).toMatch(/abortSummary\(cause, \{[\s\S]{0,200}\.\.\.endingContext\(\)/);
    expect(runner).toMatch(/const ending = endingContext\(\);[\s\S]{0,400}timedOutSummary\(minutes, ending\)/);
  });
  it('the route answers it from the build\'s own waste ledger and clock', () => {
    expect(route).toContain('providerFaultNow: () => engineTimeDominated(providerWaste, Date.now() - buildStartedAt)');
  });
});
