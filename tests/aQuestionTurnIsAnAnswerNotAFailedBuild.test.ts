import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { answeredInsteadOfBuilding, decideAnswerOnlyGate } from '../src/server/AgentV3/answerOnlyTurn';
import { readTurnAnswer } from '../src/server/AgentV3/turnAnswer';

// r6–r10 autopsy (owner 2026-10-18): a build turn that only asked a question or declined, writing nothing,
// was judged as a failed build (RED gate as ERROR, starter preview started, "engine slow"). It is an answer.
describe('a question / decline turn is an answer, not a failed build', () => {
  it('zero files + asked or declined → answered', () => {
    expect(answeredInsteadOfBuilding({ builderWrote: 0, asked: true }, {})).toBe(true);
    expect(answeredInsteadOfBuilding({ builderWrote: 0, declined: true }, {})).toBe(true);
  });
  it('wrote files, or neither asked nor declined → not', () => {
    expect(answeredInsteadOfBuilding({ builderWrote: 3, asked: true }, {})).toBe(false);
    expect(answeredInsteadOfBuilding({ builderWrote: 0 }, {})).toBe(false);
  });
  it('an APK-flow handoff is an answer throughout the verdict, not an empty failed build', () => {
    const answer = readTurnAnswer('Use More → Download APK → Build my APK now.', 'APK bana do');
    expect(answer.pointed).toBe(true);
    expect(answeredInsteadOfBuilding({ builderWrote: 0, ...answer }, {})).toBe(true);
    expect(decideAnswerOnlyGate(answeredInsteadOfBuilding({ builderWrote: 0, ...answer }, {}), 'red').record)
      .toEqual({ severity: 'info', autoResolved: true });
    expect(answeredInsteadOfBuilding({ builderWrote: 1, ...answer }, {})).toBe(false);
    expect(answeredInsteadOfBuilding({ builderWrote: 0, ...readTurnAnswer('Open Download APK.', 'Add a timer to my app') }, {})).toBe(false);
  });
  it('AGENTV3_ANSWER_TURN_NOT_BUILD=off restores the old judgement', () => {
    expect(answeredInsteadOfBuilding({ builderWrote: 0, asked: true }, { AGENTV3_ANSWER_TURN_NOT_BUILD: 'off' })).toBe(false);
  });
  it('the gate on an answered turn is recorded as info, not an error', () => {
    const notes: unknown[] = [];
    const g = decideAnswerOnlyGate(true, 'red', { record: (n: unknown) => notes.push(n) } as never);
    expect((g.record as { severity?: string }).severity).toBe('info');
  });
  it('the route wires it: gate, starter preview and the slow-engine line all read answerOnlyNow()', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('|| answeredInsteadOfBuilding({ builderWrote: builderWroteCount(), ...answeredHolder });');
    expect(route).toContain('Object.assign(answeredHolder, modelAnswer);');
    expect(route).toContain('buildWasRequested: userAskedToBuildAnApp && !answerOnlyNow(),');
    expect(route).toContain('expectsArtifacts: expectsArtifacts && !answerOnlyNow(),');
    expect(route).toContain('if (!refused && !stopped && !interrupted && !answerOnlyNow()) {');
    // the holder is filled before any reader runs
    expect(route.indexOf('Object.assign(answeredHolder')).toBeLessThan(route.indexOf('expectsArtifacts: expectsArtifacts && !answerOnlyNow(),'));
  });
});
