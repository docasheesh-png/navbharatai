// Build d62bf22d (2026-10-17): "Import this app … give me a short survey … Do not change any files yet."
// Nothing was built, yet one preview finding became an ERROR, the gate went RED, the verdict was flipped
// to ok:false and the survey ended "NOT ready to use … Reply 'fix it'".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  isAnswerOnlyTurn, previewFailedSeverity, previewFailedNarration, decideAnswerOnlyGate, ANSWER_ONLY_GATE_CODE,
} from '../src/server/AgentV3/answerOnlyTurn';
import { releaseGateRecord } from '../src/server/AgentV3/releaseGate';

const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

describe('a turn that only answered is described by the gate, not judged by it', () => {
  it('answer-only = not asked to build AND wrote nothing', () => {
    expect(isAnswerOnlyTurn({ expectsArtifacts: false, builderWrote: 0 })).toBe(true);
    expect(isAnswerOnlyTurn({ expectsArtifacts: false, builderWrote: 1 })).toBe(false); // a change is judged
    expect(isAnswerOnlyTurn({ expectsArtifacts: true, builderWrote: 0 })).toBe(false); // an empty BUILD still fails
  });

  it('a preview that did not render is a warning on an answer-only turn, an error on a build', () => {
    expect(previewFailedSeverity(true)).toBe('warning');
    expect(previewFailedSeverity(false)).toBe('error');
  });

  it('the user is not told to "fix it" about files we were told not to touch', () => {
    const said = previewFailedNarration(true, ['console: x']);
    expect(said).toMatch(/not changed any files/);
    expect(said).not.toMatch(/fix it|NOT ready/i);
    expect(previewFailedNarration(false, ['console: x'])).toMatch(/I'll fix it/); // a build keeps its words
  });

  it('a RED gate on an answer-only turn is info + closed, with the reason recorded; a build keeps the old record', () => {
    const recorded: unknown[] = [];
    const diag = { record: (r: unknown) => recorded.push(r) };
    const ordinary = releaseGateRecord({ state: 'red' }, { buildOk: false, stoppedByUser: false, awaitsShell: false });
    expect(ordinary.severity).toBe('error');
    const a = decideAnswerOnlyGate(true, 'red', diag);
    expect({ ...ordinary, ...a.record }).toEqual({ severity: 'info', autoResolved: true });
    expect(a.answerOnly).toBe(true);
    expect((recorded[0] as { code: string }).code).toBe(ANSWER_ONLY_GATE_CODE);
    const b = decideAnswerOnlyGate(false, 'red', diag);
    expect({ ...ordinary, ...b.record }).toEqual(ordinary); // a build's record is exactly what it was
    expect(recorded).toHaveLength(1);
  });

  it('the route: the RED → ok:false flip skips an answer-only turn, and both preview lines use the rule', () => {
    expect(route).toContain('const settled = answerOnlyGate.answerOnly ? undefined : result;');
    expect(route).toContain('const answerOnlyNow = (): boolean => isAnswerOnlyTurn({ expectsArtifacts, builderWrote: builderWroteCount() })');
    expect(route).toContain("severity: previewFailedSeverity(answerOnlyNow()), code: 'OUTCOME_PREVIEW_FAILED'");
    expect(route).toContain('text: previewFailedNarration(answerOnlyNow(), problems)');
    expect(route).toMatch(/\.\.\.releaseGateRecord\(gate, \{[\s\S]{0,400}?\}\),\n\s*\.\.\.answerOnlyGate\.record,[^\n]*\n\s*code: 'RELEASE_GATE',/);
  });
});
