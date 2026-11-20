// failedbr #1896 (2026-11-20): "Ham tumko Jo banane Wale game Banakar do" was built as a space shooter with no
// question, and the report could not say whether the clarity judge read it as clear or was never asked: the
// decision went only to the server log. It is now a CLARITY_DECISION line in the build report.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clarityDecision, clarityJudgeSkipReason, shouldJudgeClarity } from '../src/server/AgentV3/clarityGate';

const base = {
  enabled: true, newBuild: true, workspaceHoldsOnlyOurStarter: true, earlierBuildableRequest: false,
  importing: false, attachments: 0, askedLastTurn: false, alreadyAsking: false,
  prompt: 'Ham tumko Jo banane Wale game Banakar do', isStarterPrompt: false,
};

describe('the clarity decision is in the build report (failedbr #1896)', () => {
  it('no skip reason when the judge runs (the #1896 request on an empty workspace)', () => {
    expect(shouldJudgeClarity(base)).toBe(true);
    expect(clarityJudgeSkipReason(base)).toBeNull();
  });

  it.each([
    [{ earlierBuildableRequest: true }, /earlier message/],
    [{ workspaceHoldsOnlyOurStarter: false }, /already holds an app/],
    [{ isStarterPrompt: true }, /starter chip/],
    [{ attachments: 1 }, /attached/],
    [{ enabled: false }, /gate is off/],
  ])('names the condition that kept the judge out: %o', (patch, re) => {
    expect(clarityJudgeSkipReason({ ...base, ...patch })).toMatch(re);
  });

  it('the decision carries its line both when the judge runs and when it does not', async () => {
    const ran = await clarityDecision(base, async () => ({ verdict: 'clear', category: 'game', ms: 812 }));
    expect(ran).toEqual({ vagueCategory: null, line: 'The clarity judge read the request as clear (game, 812 ms).' });
    const vague = await clarityDecision(base, async () => ({ verdict: 'vague', category: 'game', ms: 700 }));
    expect(vague.vagueCategory).toBe('game');
    expect(vague.line).toMatch(/answered with one question/);
    let called = false;
    const skipped = await clarityDecision({ ...base, earlierBuildableRequest: true }, async () => { called = true; return { verdict: 'vague', category: 'game', ms: 1 }; });
    expect(called).toBe(false);
    expect(skipped.line).toMatch(/^The clarity judge was not consulted: an earlier message/);
  });

  it('the route records the decision in the build report', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toMatch(/const decided = await clarityDecision\(/);
    expect(route).toMatch(/clarityReportLine = decided\.line;/);
    expect(route).toMatch(/code: 'CLARITY_DECISION', message: clarityReportLine/);
  });
});
