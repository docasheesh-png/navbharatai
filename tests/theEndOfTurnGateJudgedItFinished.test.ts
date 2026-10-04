// Q-310 (autopsy d798ddd3, "Calculator app", 3.7 min): the app was finished in 9 steps and the end-of-turn
// readiness gate judged it ready, but READY_BEFORE_END read "The app was never judged finished during the
// build" — only the mid-build done check wrote the mark, and on a short build it never came due.
import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { endOfTurnReadyMark, readyOverrunNote } from '../src/server/AgentV3/doneSignal';
import type { ReadinessReport } from '../src/server/AgentV3/Readiness';

const report = (over: Partial<ReadinessReport> = {}): ReadinessReport => ({
  score: 95, ready: true, blockers: [], warnings: [], tier: 'production', ...over,
});
const base = { existing: null, readiness: report(), typeErrors: 0, editingExistingApp: false, wroteThisRun: true, step: 9, elapsedMs: 120_000 };

describe('the end-of-turn gate records when the app was first finished', () => {
  it('the report\'s build: judged ready at the end, so the note says so', () => {
    const mark = endOfTurnReadyMark(base);
    expect(mark).toEqual({ step: 9, elapsedMs: 120_000, score: 95 });
    const note = readyOverrunNote(mark, 9, 120_000);
    expect(note).toContain('judged finished at step 9');
    expect(note).not.toContain('never judged finished');
  });

  it('an earlier mid-build mark is kept (it measures the FIRST time)', () => {
    const earlier = { step: 5, elapsedMs: 60_000, score: 90 };
    expect(endOfTurnReadyMark({ ...base, existing: earlier })).toBe(earlier);
  });

  it('under the mid-build check\'s own rules: not on an edit, not before a write, not over a failed compile, not when not done', () => {
    expect(endOfTurnReadyMark({ ...base, editingExistingApp: true })).toBeNull();
    expect(endOfTurnReadyMark({ ...base, wroteThisRun: false })).toBeNull();
    expect(endOfTurnReadyMark({ ...base, typeErrors: 3 })).toBeNull();
    expect(endOfTurnReadyMark({ ...base, readiness: report({ score: 70 }) })).toBeNull();
    expect(endOfTurnReadyMark({ ...base, readiness: report({ blockers: ['entry is still the starter'] }) })).toBeNull();
    expect(endOfTurnReadyMark({ ...base, readiness: null })).toBeNull();
    expect(endOfTurnReadyMark({ ...base, typeErrors: null })).not.toBeNull();
  });

  it('the runner\'s end-of-turn gate asks it, right after it judges the app', () => {
    const runner = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');
    const gate = runner.indexOf('buildHealth = { score: readiness.score');
    expect(gate).toBeGreaterThan(0);
    const after = runner.slice(gate, gate + 900);
    expect(after).toContain('readyMark = endOfTurnReadyMark({');
    expect(after).toContain('existing: readyMark, readiness,');
    expect(after).toContain("editingExistingApp: this.opts.editingExistingApp === true, wroteThisRun: dispatcher.wroteAnything(),");
  });
});
