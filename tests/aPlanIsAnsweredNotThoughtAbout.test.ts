// Autopsy a2b9c802 (2026-09-30, JARVIS, Weak). GLM flashx was benched for crawling, so both planners
// fell to kimi-k2.7-code, which always reasons first: the roadmap came back cut off at its token limit
// after 240 s and the project planner spent all 12,000 tokens thinking and returned nothing. The admin
// chose Haiku as the plan fallback ("planing ke liye haiku accha hai, to lagao") — on the PLAN ladder
// only; the Weak BUILD ladder keeps Haiku as its last rung.
import { describe, it, expect } from 'vitest';
import { planLadder, tierLadder, weakPlanHaikuEnabled } from '../src/server/AgentV3/tierLadder';
import { planRunnerChainNames } from '../src/server/routes/agentv3';

const seq = (rungs: { provider: string; model: string }[]) => rungs.map((r) => `${r.provider}:${r.model}`);

describe('a Weak plan falls to a rung that answers, not one that thinks', () => {
  it('Haiku is second on the Weak plan ladder, right after the plan rung', () => {
    const plan = seq(planLadder('weak', {}));
    expect(plan[0]).toBe('GLM:glm-4.7-flashx');
    expect(plan[1]).toBe('CLAUDE_HAIKU:haiku');
    expect(plan.indexOf('CLAUDE_HAIKU:haiku')).toBeLessThan(plan.indexOf('KIMI:kimi-k2.7-code'));
  });

  it('nothing is added or lost — the same rungs, reordered', () => {
    expect([...seq(planLadder('weak', {}))].sort()).toEqual([...seq(tierLadder('weak', {}).rungs)].sort());
  });

  it('the Weak BUILD ladder is untouched: Haiku stays last', () => {
    const build = seq(tierLadder('weak', {}).rungs);
    expect(build[build.length - 1]).toBe('CLAUDE_HAIKU:haiku');
  });

  it('Normal and Strong plan ladders are unchanged and carry no Haiku', () => {
    expect(seq(planLadder('off', {}))).not.toContain('CLAUDE_HAIKU:haiku');
    expect(seq(planLadder('mini', {}))).not.toContain('CLAUDE_HAIKU:haiku');
  });

  it('the weak-module guard still lets only Haiku through, in the new place', () => {
    expect(planRunnerChainNames(true, 'weak')).toEqual(['GLM', 'CLAUDE_HAIKU', 'KIMI', 'GLM', 'NEMOTRON']);
  });

  it('AGENTV3_WEAK_PLAN_HAIKU=off restores the previous order; anything else keeps the new one', () => {
    expect(weakPlanHaikuEnabled({})).toBe(true);
    expect(weakPlanHaikuEnabled({ AGENTV3_WEAK_PLAN_HAIKU: ' OFF ' })).toBe(false);
    expect(weakPlanHaikuEnabled({ AGENTV3_WEAK_PLAN_HAIKU: 'on' })).toBe(true);
    const off = seq(planLadder('weak', { AGENTV3_WEAK_PLAN_HAIKU: 'off' }));
    expect(off[off.length - 1]).toBe('CLAUDE_HAIKU:haiku');
  });

  it('a ladder override without Haiku is left exactly as written', () => {
    const env = { AGENTV3_LADDER_WEAK: 'GLM:glm-4.7-flashx,KIMI:kimi-k2.7-code' };
    expect(seq(planLadder('weak', env))).toEqual(['GLM:glm-4.7-flashx', 'KIMI:kimi-k2.7-code']);
  });
});
