/**
 * THE ROADMAP IS A PLAN, SO IT RUNS ON THE PLAN RUNG (admin chose "A", 2026-09-26, autopsy 7d79254b).
 *
 * The mega-roadmap planner took the BUILD chain. For a complex app that chain opens on KIMI
 * (`complex: buildIsComplex`, admin 2026-09-17), and `kimi-k2.7-code` always reasons — so an EduHub
 * build waited 76 s and 4,574 output tokens before its first file. The roadmap is one text-only call
 * that decides the steps: the plan phase's shape, so it now asks the plan phase's runner. The BUILD
 * still opens on KIMI for a complex app; only this planner moved.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plannerPlanRungEnabled } from '../src/server/routes/agentv3';
import { planLadder, tierLadder, withoutCheapFlashLead } from '../src/server/AgentV3/tierLadder';

const NO_NEMOTRON = {} as NodeJS.ProcessEnv;

describe('the plan rung is not the complex build opener', () => {
  it('on Weak and Normal the plan opens on the non-reasoning flashx rung, the complex build on KIMI', () => {
    for (const tier of ['weak', 'off'] as const) {
      expect(planLadder(tier, NO_NEMOTRON)[0], tier).toEqual({ provider: 'GLM', model: 'glm-4.7-flashx' });
      expect(withoutCheapFlashLead(tierLadder(tier, NO_NEMOTRON).rungs)[0].provider, tier).toBe('KIMI');
    }
  });

  it('the plan chain still carries the whole ladder behind its first rung — nothing is lost', () => {
    const plan = planLadder('weak', NO_NEMOTRON).map((r) => `${r.provider}:${r.model}`);
    for (const r of tierLadder('weak', NO_NEMOTRON).rungs) expect(plan).toContain(`${r.provider}:${r.model}`);
  });
});

describe('the no-deploy revert', () => {
  it('is on unless the word is off', () => {
    expect(plannerPlanRungEnabled({})).toBe(true);
    expect(plannerPlanRungEnabled({ AGENTV3_PLANNER_PLAN_RUNG: 'on' })).toBe(true);
    expect(plannerPlanRungEnabled({ AGENTV3_PLANNER_PLAN_RUNG: 'garbage' })).toBe(true);
    expect(plannerPlanRungEnabled({ AGENTV3_PLANNER_PLAN_RUNG: ' OFF ' })).toBe(false);
  });
});

describe('🔒 the wiring', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const at = route.indexOf('system: megaRoadmapSystemPrompt(),');
  const block = route.slice(Math.max(0, at - 2500), at);

  it('the roadmap call is built by tierPlanRunner, with the build chain only as the fallback', () => {
    // tsc and vitest cannot see which runner a call site picks — that is how this ran on KIMI.
    expect(block).toMatch(/tierPlanRunner\(powerLevelReqEffective, noClaudeBuild, \{/);
    expect(block).toMatch(/\(rmPlanRunner \?\? makeFastTextRunner\(/);
    expect(block).toContain('plannerPlanRungEnabled()');
  });

  it('the planner still reports the provider that answered, so its cost is priced on the real rung', () => {
    expect(block).toMatch(/onProviderUsed: \(used\) => \{ rmProvider = used; rmReported = true; captureProvider\(used\); \}/);
  });

  it('the project-mode planner is the same kind of call and asks the same runner (autopsy eed79815)', () => {
    // The sibling of the roadmap: it opened on KIMI and GLM, both spent their whole allowance thinking,
    // and it timed out at 315 s before the build wrote a line.
    const pp = route.slice(route.indexOf('let ppReported = false;'), route.indexOf('let ppReported = false;') + 3000);
    expect(pp).toContain('plannerPlanRungEnabled()');
    expect(pp).toMatch(/tierPlanRunner\(powerLevelReqEffective, noClaudeBuild, \{/);
    expect(pp).toMatch(/const call = ppRunner\.runTurn\(/);
  });

  it('a planner that nobody answered is never recorded as a Claude call (fastLaneCallIdentity)', () => {
    // A weak build's timed-out planner was logged `anthropic / claude-sonnet-4-6` — a vendor the build
    // could not have called. Both planners now record through the helper that says `unknown` instead.
    expect(route).toMatch(/fastLaneCallIdentity\(rmReported, rmProvider, fastBuildModel\(\)\)/);
    expect(route).toMatch(/fastLaneCallIdentity\(ppReported, ppProvider, fastBuildModel\(\)\)/);
  });

  it('the plan phase itself is untouched', () => {
    expect(route).toContain('const planGrok = tierPlanRunner(powerLevelReqEffective, noClaudeBuild);');
  });
});
