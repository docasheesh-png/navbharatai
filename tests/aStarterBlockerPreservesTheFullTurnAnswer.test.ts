import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { modelsOwnWords, readTurnAnswer } from '../src/server/AgentV3/turnAnswer';

const runnerSource = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');

describe('starter-blocker answers survive the short status summary', () => {
  it('captures the full final turn before either readiness summary can replace it', () => {
    const capture = runnerSource.indexOf(
      'if (!starvedTurn && turn.text.trim()) modelAnswer = turn.text.trim();',
    );
    const standDown = runnerSource.indexOf('if (resume.standDown && starterBlocker)');
    const verboseSummary = runnerSource.indexOf(
      "if ((process.env.AGENTV3_VERBOSE_READINESS ?? '').trim().toLowerCase() === 'on')",
    );
    const shortSummary = runnerSource.indexOf('summary = starterSummary(turn.text);');
    expect(capture).toBeGreaterThan(standDown);
    expect(verboseSummary).toBeGreaterThan(capture);
    expect(shortSummary).toBeGreaterThan(capture);
  });

  it('lets the existing asked-user recorder inspect the full turn after a read-only tool call', () => {
    const fullTurn = 'I read the file and understand its sound recipes.\n\nWould you like me to continue and build the game now?';
    const shortenedSummary = 'Nothing has been built yet — the workspace still contains the starter page.';
    expect(readTurnAnswer(shortenedSummary).asked).toBe(false);
    const answer = modelsOwnWords({ summary: shortenedSummary, modelAnswer: fullTurn });
    expect(answer).toBe(fullTurn);
    expect(readTurnAnswer(answer).asked).toBe(true);
  });
  it('records asked-user and true-empty outcomes only after unfinished resume stands down', () => {
    const standDown = runnerSource.indexOf('if (resume.standDown && starterBlocker)');
    const asked = runnerSource.indexOf("code: 'OUTCOME_ASKED_USER'", standDown);
    const empty = runnerSource.indexOf("code: 'OUTCOME_EMPTY_BUILD'", standDown);
    const resume = runnerSource.indexOf('if (resume.resume && !this.opts.signal?.aborted)');
    const failedResult = runnerSource.indexOf('ok = false;', standDown);
    expect(runnerSource).toContain('turnAskedTheUser(turn.text)');
    expect(runnerSource).toContain('turnDeclined(turn.text)');
    expect(runnerSource).toContain('this.opts.hasExistingFiles?.() === false');
    expect(resume).toBeGreaterThan(-1);
    expect(standDown).toBeGreaterThan(resume);
    expect(asked).toBeGreaterThan(standDown);
    expect(empty).toBeGreaterThan(asked);
    expect(failedResult).toBeGreaterThan(standDown);
  });

});
