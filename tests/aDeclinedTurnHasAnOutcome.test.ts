// 🔴 A DECLINED TURN HAS AN OUTCOME (failedbr #2246, 2026-11-20 — "kya aap kisi game ka hack bana sakte hai").
//
// The model refused honestly and offered real games. TURN_DECLINED said so, and then OUTCOME_UNEXPLAINED filed an
// ERROR — "the engine did not record why". (UPSELL_SUPPRESSED stays a warning after a refusal on purpose: a decline
// can be the model wrongly refusing a legitimate build, which is worth flagging — pinned by starvationEvidenceWording.) Its sibling (a turn that asked the user a question) has had OUTCOME_ASKED_USER since autopsy 35bd9e17.
// Reversion: drop `recordDeclinedOutcome(buildDiag)` from the route and the wiring test fails; make
// recordDeclinedOutcome a no-op and the first test fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { BuildDiagnostics, outcomeCodeOf } from '../src/server/AgentV3/BuildDiagnostics';
import { recordDeclinedOutcome } from '../src/server/AgentV3/answerOnlyTurn';

describe('#2246: a refusal ends with OUTCOME_DECLINED, not an unexplained error', () => {
  it('the declined turn gets its own outcome, at info, in the outcome slot', () => {
    const d = new BuildDiagnostics();
    d.record({ phase: 'build', severity: 'info', code: 'TURN_DECLINED', message: 'declined', autoResolved: true });
    recordDeclinedOutcome(d);
    expect(outcomeCodeOf(d.report().issues)).toBe('OUTCOME_DECLINED');
    const row = d.report().issues.find((i) => i.code === 'OUTCOME_DECLINED');
    expect(row?.severity).toBe('info');
    expect(d.report().issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });
  it('one ending never carries two: an outcome already on the timeline wins', () => {
    const d = new BuildDiagnostics();
    d.record({ phase: 'build', severity: 'info', code: 'OUTCOME_USER_STOPPED', message: 'stopped', autoResolved: true });
    recordDeclinedOutcome(d);
    expect(d.report().issues.filter((i) => /^OUTCOME_/.test(i.code)).map((i) => i.code)).toEqual(['OUTCOME_USER_STOPPED']);
  });
});

describe('the route wiring', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('records the outcome right after TURN_DECLINED', () => {
    const at = route.indexOf("code: 'TURN_DECLINED'");
    expect(at).toBeGreaterThan(-1);
    expect(route.indexOf('recordDeclinedOutcome(buildDiag)', at)).toBeGreaterThan(at);
    expect(route.indexOf('recordDeclinedOutcome(buildDiag)', at) - at).toBeLessThan(800);
  });

});
