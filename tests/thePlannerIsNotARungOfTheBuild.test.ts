// failedbr #1200, #1188 (2026-11-20): the big-app roadmap planner ran on Haiku — the same model as the Weak ladder's last
// rung — and LADDER_DEPTH said "Fell to rung 5 of 5" for builds whose every builder call ran on rung 2.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ladderDepthUsed } from '../src/server/AgentV3/ladderDepth';
import { tierLadder } from '../src/server/AgentV3/tierLadder';
import { PHASE_PLANNER } from '../src/server/AgentV3/billingPhase';

describe('the planner is not a rung of the build (failedbr #1200)', () => {
  const rungs = tierLadder('weak').rungs;
  it('a Haiku planner slice does not deepen the ladder', () => {
    const slices = [
      { provider: 'CLAUDE_HAIKU', model: 'claude-haiku-4-5', phase: PHASE_PLANNER, usage: { outputTokens: 900 } },
      { provider: 'KIMI', model: 'kimi-k2.7-code', usage: { outputTokens: 400 } },
    ];
    expect(ladderDepthUsed(slices, rungs).depth).toBe(2);
    expect(ladderDepthUsed(slices.map(({ phase: _p, ...s }) => s), rungs).depth).toBe(5);
  });
  it('🔒 all three planners record their usage inside the planner phase', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    for (const v of ['rmProvider', 'bpProvider', 'ppProvider']) {
      expect(route, v).toMatch(new RegExp(`runInBillingPhase\\(PHASE_PLANNER, async \\(\\) => captureTurnUsage\\(${v},`));
    }
  });
});
