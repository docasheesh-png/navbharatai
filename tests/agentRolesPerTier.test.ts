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
describe('Judge: a different model from the builder, at the lowest input price that reasons well; never Opus', () => {
  it('pure: Weak/Normal judge on glm-5.3 when a GLM key exists; Strong on Grok; Sonnet is the fallback', () => {
    expect(resolveJudgeKind('free', 'grok', undefined, 'glm')).toBe('glm');
    expect(resolveJudgeKind('paid', 'grok', undefined, 'glm')).toBe('glm');
    expect(resolveJudgeKind('power', 'grok', undefined, 'glm')).toBe('grok');
    expect(resolveJudgeKind('paid', 'grok', undefined, undefined)).toBe('grok');
    expect(resolveJudgeKind('paid', undefined, undefined, undefined)).toBe('sonnet');
    for (const mode of ['free', 'paid', 'power'] as const) {
      expect(resolveJudgeKind(mode, 'grok', 'sonnet', 'glm')).toBe('sonnet'); // AGENTV3_REVIEWER=sonnet wins
      expect(resolveJudgeKind(mode, 'grok', undefined, 'glm') as string).not.toBe('opus');
    }
  });
  it('wiring: the judge chooser never returns Opus, and the Claude judge is Sonnet only', () => {
    const at = route.indexOf('export function resolveJudgeKind(');
    const body = route.slice(at, route.indexOf('\n}\n', at));
    expect(body).not.toMatch(/'opus'/);
    const sel = route.indexOf('function selectReviewJudge(');
    const selBody = route.slice(sel, route.indexOf('\n}\n', sel));
    // ⚠️ RE-ANCHORED 2026-09-20. The judge is built as a CHAIN of candidates now (judgeChain.ts), so
    // the GLM judge is a candidate rather than an inline return — but WHICH model it is, and that it
    // is filed as 'glm', are exactly the two facts this line has always been about.
    expect(selBody).toContain("openAiJudgeCandidate('glm'");
    expect(selBody).toContain("process.env.AGENTV3_GLM_JUDGE_MODEL || 'glm-5.3'");
    expect(selBody).not.toMatch(/opusModel\(\)/);
  });
  it('🔒 White-Label: the review narration the USER sees names no vendor or model', () => {
    const lines = [...route.matchAll(/type: 'narration'[^\n]*reviewer[^\n]*/gi)].map((m) => m[0]);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) {
      expect(l).not.toMatch(/\$\{reviewerName\}/);
      expect(l).not.toMatch(/grok|sonnet|opus|glm|claude|anthropic|gemini/i);
    }
  });
});

describe('Plan = the tier\'s plan rung, then its own ladder; Grok no longer plans', () => {
  it('pure: the plan rungs — the cheapest rung that reasons well, per tier', () => {
    // 2026-09-17: the plan rung follows the LEAD rung, which moved 5.3-flash → 4.7-flashx. Plan is an
    // input-heavy, output-light call, so it belongs on the cheapest rung that reasons well — and
    // FlashX is both cheaper ($0.07 vs $0.15 in) and, being 4.x, able to be told to stop reasoning,
    // which is the exact failure that made 5.3-flash produce 280 hard 400s in one build (ee20478d).
    expect(PLAN_RUNG.weak.model).toBe('glm-4.7-flashx');
    expect(PLAN_RUNG.off.model).toBe('glm-4.7-flashx');
    expect(PLAN_RUNG.mini).toEqual({ provider: 'GLM', model: 'glm-5.3' });
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
    // The symbol gained a suffix on 2026-09-17 (`classifyIntentSmartDetailed`, the reader's fourth
    // answer) — the invariant asserted here, that this call runs on the FREE router, is unchanged.
    const at = route.indexOf('classifyIntentSmartDetailed(\n');
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at - 600, at)).toContain("AIRouterManager.getRouter('free')");
  });
});
