import { describe, expect, it } from 'vitest';
import {
  ANSWER_ONLY_GATE_CODE, answeredInsteadOfBuilding, answerOnlyGateNote, decideAnswerOnlyGate,
  isAnswerOnlyTurn, type AnswerOnlyFacts,
} from '../src/server/AgentV3/answerOnlyTurn';
import { releaseGateRecord } from '../src/server/AgentV3/releaseGate';
import type { TurnAnswer } from '../src/server/AgentV3/turnAnswer';

type TurnFacts = AnswerOnlyFacts & Partial<TurnAnswer>;
const gateStates = ['red', 'yellow', 'green', 'unknown'] as const;

// Synthetic facts only. The shared note receives no app-existence or original-request input:
// its wording must remain true for either context, without inventing either fact.
const answerCases: { name: string; facts: TurnFacts }[] = [
  { name: 'an informational answer without an app', facts: { expectsArtifacts: false, builderWrote: 0 } },
  { name: 'a survey of an existing app', facts: { expectsArtifacts: false, builderWrote: 0 } },
  { name: 'a clarification of a requested build', facts: { expectsArtifacts: true, builderWrote: 0, asked: true } },
  { name: 'a declined requested build without an app', facts: { expectsArtifacts: true, builderWrote: 0, declined: true } },
  { name: 'a platform-feature handoff', facts: { expectsArtifacts: true, builderWrote: 0, pointed: true } },
  { name: 'a third-party capability answer', facts: { expectsArtifacts: true, builderWrote: 0, notOurs: true } },
];

describe('the answer-only gate note states the shared fact, not the original request or app existence', () => {
  describe.each(answerCases)('$name', ({ facts }) => {
    it.each(gateStates)('keeps the %s gate informational without inventing a premise', (gateState) => {
      const answerOnly = isAnswerOnlyTurn(facts) || answeredInsteadOfBuilding(facts, {});
      expect(answerOnly).toBe(true);
      const notes: ReturnType<typeof answerOnlyGateNote>[] = [];
      const decision = decideAnswerOnlyGate(answerOnly, gateState, { record: (note) => notes.push(note) });

      expect(decision).toEqual({ answerOnly: true, record: { severity: 'info', autoResolved: true } });
      expect(notes).toEqual([{
        phase: 'readiness', severity: 'info', code: ANSWER_ONLY_GATE_CODE, autoResolved: true,
        message: `Answer-only turn: the release gate (${gateState.toUpperCase()}) is informational and did not decide this turn's verdict.`,
      }]);
      expect(notes[0].message).not.toMatch(/nothing was asked|existing app|no file was written/i);
    });
  });

  it.each([
    { name: 'an ordinary empty build', facts: { expectsArtifacts: true, builderWrote: 0 } },
    { name: 'an answer that wrote a file', facts: { expectsArtifacts: false, builderWrote: 1 } },
    { name: 'a decline after a file was written', facts: { expectsArtifacts: true, builderWrote: 1, declined: true } },
    { name: 'a question after a file was written', facts: { expectsArtifacts: true, builderWrote: 1, asked: true } },
  ] satisfies { name: string; facts: TurnFacts }[])('preserves the ordinary gate for $name', ({ facts }) => {
    const answerOnly = isAnswerOnlyTurn(facts) || answeredInsteadOfBuilding(facts, {});
    expect(answerOnly).toBe(false);
    const notes: ReturnType<typeof answerOnlyGateNote>[] = [];
    const decision = decideAnswerOnlyGate(answerOnly, 'red', { record: (note) => notes.push(note) });
    const ordinary = releaseGateRecord({ state: 'red' }, { buildOk: false, stoppedByUser: false, awaitsShell: false });

    expect(ordinary.severity).toBe('error');
    expect(decision).toEqual({ answerOnly: false, record: {} });
    expect({ ...ordinary, ...decision.record }).toEqual(ordinary);
    expect(notes).toEqual([]);
  });

  it('keeps the disabled answer-turn override from emitting the informational note', () => {
    const answerOnly = answeredInsteadOfBuilding({ builderWrote: 0, declined: true }, { AGENTV3_ANSWER_TURN_NOT_BUILD: 'off' });
    const notes: ReturnType<typeof answerOnlyGateNote>[] = [];
    expect(answerOnly).toBe(false);
    expect(decideAnswerOnlyGate(answerOnly, 'red', { record: (note) => notes.push(note) }))
      .toEqual({ answerOnly: false, record: {} });
    expect(notes).toEqual([]);
  });

  it('keeps a missing or throwing diagnostic recorder from affecting the answer-only decision', () => {
    const expected = { answerOnly: true, record: { severity: 'info', autoResolved: true } };
    expect(decideAnswerOnlyGate(true, 'unknown')).toEqual(expected);
    expect(decideAnswerOnlyGate(true, 'unknown', { record: () => { throw new Error('Synthetic recorder failure'); } }))
      .toEqual(expected);
  });
});
