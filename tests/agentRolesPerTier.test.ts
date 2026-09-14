import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveJudgeKind, planRunnerChainNames } from '../src/server/routes/agentv3';
import { visionProviderChain } from '../src/server/lib/visionDescribe';
import { PLAN_RUNG } from '../src/server/AgentV3/tierLadder';

const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

/**
 * THE AGENT × TIER TABLE (admin-approved 2026-09-14). Aims, verbatim: "user ki app best of best bane —
 * 1 try me" and "mera kharcha kam se kam ho". This suite pins the three roles the table moved and the
 * two it deliberately left alone, so a later "tidy-up" cannot quietly put Opus back on the judge or
 * Grok back on the plan.
 */
describe('Judge = Grok on every tier; Opus is never the judge', () => {
  it('pure: grok when a key exists, Sonnet otherwise, on free, paid AND power', () => {
    for (const mode of ['free', 'paid', 'power'] as const) {
      expect(resolveJudgeKind(mode, 'k', undefined)).toBe('grok');
      expect(resolveJudgeKind(mode, undefined, undefined)).toBe('sonnet');
      expect(resolveJudgeKind(mode, 'k', 'sonnet')).toBe('sonnet');
    }
  });
  it('wiring: the judge chooser ignores the tier — one rule, not three', () => {
    const at = route.indexOf('export function resolveJudgeKind(');
    const body = route.slice(at, route.indexOf('\n}\n', at));
    expect(body).not.toMatch(/return 'opus'/);
    expect(body).toContain('selectReviewer({ reviewer: reviewerEnv, grokKey })');
  });
});

describe('Plan = the tier\'s plan rung, then its own ladder; Grok no longer plans', () => {
  it('pure: the plan rungs are the table\'s', () => {
    expect(PLAN_RUNG.weak.model).toBe('glm-5.3-flash');
    expect(PLAN_RUNG.off.model).toBe('kimi-k2.7-code');
    expect(PLAN_RUNG.mini).toEqual({ provider: 'CLAUDE', model: 'sonnet' });
    for (const tier of ['weak', 'off', 'mini'] as const) expect(planRunnerChainNames(tier === 'weak', tier)).not.toContain('GROK');
  });
  it('wiring: the plan phase is built by tierPlanRunner from the resolved tier, and grokPlanRunner is gone', () => {
    expect(route).toContain('tierPlanRunner(powerLevelReqEffective, noClaudeBuild)');
    expect(route).not.toContain('grokPlanRunner(');
    // …and the plan runner is assembled by the SAME ladder mapper and guard as the build chain.
    const at = route.indexOf('function tierPlanRunner(');
    const body = route.slice(at, route.indexOf('\n}\n', at));
    expect(body).toContain('enforceNoClaude(ladderRunners(planLadder(level)), noClaude)');
  });
});

describe('Vision: Strong is Claude-first (Haiku describe tier); Weak/Normal stay Gemini → Grok', () => {
  it('pure: the chains', () => {
    expect(visionProviderChain({ useClaude: true })).toEqual(['claude', 'gemini', 'grok']);
    expect(visionProviderChain({ noClaude: true })).toEqual(['gemini', 'grok']);
    expect(visionProviderChain({ noClaude: true, useClaude: true })).toEqual(['gemini', 'grok']); // weak wins
  });
  it('wiring: useClaude follows the PAID PREMIUM tier, not the retired pinned-Opus flag', () => {
    expect(route).toMatch(/describeVisionAttachments\(docAttachments, \{ useClaude: powerSpecResolved\.powerMode/);
    expect(route).not.toMatch(/useClaude: pinnedOpus/);
  });
});

describe('what the table deliberately did NOT move — and why it is still right', () => {
  it('safety triage is deterministic code, not a model call (₹0)', () => {
    const safety = readFileSync(resolve(__dirname, '../src/server/lib/promptSafety.ts'), 'utf8');
    const at = safety.indexOf('export function triagePrompt(');
    expect(at).toBeGreaterThan(-1);
    // A synchronous function cannot be awaiting a provider.
    expect(safety.slice(at, at + 80)).not.toContain('async');
  });
  it('the intent doubt-reader runs on the FREE chat router (glm-4.7-flash led, $0) for every tier', () => {
    const at = route.indexOf('classifyIntentSmart(\n');
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at - 600, at)).toContain("AIRouterManager.getRouter('free')");
  });
});
