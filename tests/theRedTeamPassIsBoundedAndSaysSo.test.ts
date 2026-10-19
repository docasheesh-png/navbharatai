import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { redTeamBudgetMs, redTeamStepMs, redTeamRunNote, REDTEAM_BUDGET_MS_DEFAULT } from '../src/server/AgentV3/FuzzProbe';

// Build 2f46a4d8: 98 silent seconds between the GREEN gate and RUNTIME_VERIFIED — the red-team pass.
describe('the red-team pass is bounded and says what it did', () => {
  it('defaults to 30 s, env-configurable, clamped', () => {
    expect(redTeamBudgetMs({})).toBe(REDTEAM_BUDGET_MS_DEFAULT);
    expect(redTeamBudgetMs({ AGENTV3_REDTEAM_BUDGET_MS: '90000' })).toBe(90_000);
    expect(redTeamBudgetMs({ AGENTV3_REDTEAM_BUDGET_MS: '100' })).toBe(REDTEAM_BUDGET_MS_DEFAULT);
    expect(redTeamBudgetMs({ AGENTV3_REDTEAM_BUDGET_MS: '9999999' })).toBe(300_000);
  });
  it('a browser step never runs past the deadline', () => {
    expect(redTeamStepMs(10_000, 15_000, 0)).toBe(10_000);
    expect(redTeamStepMs(100_000, 15_000, 0)).toBe(15_000);
    expect(redTeamStepMs(500, 15_000, 0)).toBe(1_000);
  });
  it('a clean run is recorded', () => {
    const n = redTeamRunNote({ casesRun: 7, crashes: 0, ms: 21_400, budgetMs: 30_000 });
    expect(n.code).toBe('REDTEAM_RAN');
    expect(n.message).toMatch(/7 hostile input case\(s\) in 21s \(budget 30s\), no crash/);
  });
  it('the route uses the budget, clips every step, and always records the run', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).not.toContain('Date.now() + 90_000');
    expect(route).toContain("redTeamStepMs(redTeamDeadline, 15_000), 'redteam-nav'");
    expect(route).toContain("redTeamStepMs(redTeamDeadline, 12_000), 'redteam-type'");
    expect(route).toContain("redTeamStepMs(redTeamDeadline, 12_000), 'redteam-submit'");
    expect(route).toContain('buildDiag.record(redTeamRunNote({');
  });
});
