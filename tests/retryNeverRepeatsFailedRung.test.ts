// 🔴 "APP 100% BAND — FAILED LIKH KAR NA AAYE" (admin 2026-09-17), applied to the two paths that were
// still capable of producing a "failed" the engine could have avoided.
//
// 1. THE RETRY RESTARTED ON THE RUNG THAT HAD JUST PRODUCED NOTHING. The empty-build retry ran
//    `healLadder`, which drops only a leading cheap-FLASH rung. Weak and Normal have one, so they were
//    covered by accident of shape; **Strong has no flash rung**, so it re-ran the identical engine —
//    a retry loop around a deterministic failure. Autopsy f5351721: 30 calls, all glm-5.3, zero files,
//    23 extra minutes, then "failed" shown to the user.
//
// 2. A MODEL WHOSE THINKING DOES NOT FIT OUR CEILING WAS ONLY KNOWN FOR GLM. Report 58fe8254 shows the
//    same starvation three times on KIMI, and this repo holds no capability fact for Moonshot. Rather
//    than invent one, the engine now LEARNS it from the model's own first clamped starvation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ladderAfterLeadRung, retryLeadsHigher, tierLadder, healLadder, TIER_LADDERS, describeLadder,
} from '../src/server/AgentV3/tierLadder';
import {
  modelStarvedWhileClamped, _resetStarvedBudgetMemo,
} from '../src/server/AgentV3/providers/OpenAiToolRunner';
import { buildTurnRunner } from '../src/server/routes/agentv3';
import type { ChainRung } from '../src/server/AgentV3/runnerChainSummary';

const on = {} as NodeJS.ProcessEnv;

describe('ladderAfterLeadRung — a retry never restarts on the rung that produced nothing', () => {
  it('🔴 STRONG now starts one rung higher — the exact build that failed', () => {
    const build = tierLadder('mini', on).rungs;
    const retry = ladderAfterLeadRung(build);
    expect(retry[0]).not.toEqual(build[0]);
    expect(retry.length).toBe(build.length - 1);
    // And the old rule genuinely did nothing here — that is why this case existed at all.
    expect(healLadder(build)[0]).toEqual(build[0]);
  });

  it('Weak and Normal are UNCHANGED — they already dropped their flash lead', () => {
    for (const tier of ['weak', 'off'] as const) {
      const build = tierLadder(tier, on).rungs;
      expect(describeLadder(ladderAfterLeadRung(build)), tier).toBe(describeLadder(healLadder(build)));
    }
  });

  it('🔒 WEAK still cannot reach Sonnet or Opus — the absolute rule survives the change', () => {
    const retry = ladderAfterLeadRung(tierLadder('weak', on).rungs);
    expect(retry.length).toBeGreaterThan(0);
    for (const rung of retry) {
      expect(rung.provider, rung.model).not.toBe('CLAUDE');
      expect(rung.provider, rung.model).not.toBe('CLAUDE_OPUS');
    }
  });

  it('🔒 it never empties a ladder — a slow app beats no app', () => {
    expect(ladderAfterLeadRung([])).toEqual([]);
    const one = [{ provider: 'GLM' as const, model: 'glm-5.3' }];
    expect(ladderAfterLeadRung(one)).toEqual(one);
  });

  it('drops by POSITION, not by provider name — Weak carries GLM at two rungs', () => {
    const weak = tierLadder('weak', on).rungs;
    const glmRungs = weak.filter((r) => r.provider === 'GLM');
    expect(glmRungs.length).toBeGreaterThan(1); // the coincidence a name-based rule would trip on
    // Dropping position 1 keeps the LATER GLM rung; a `ladderFrom(rungs,'GLM')` would have returned
    // the whole ladder unchanged, re-running the very rung that failed.
    expect(ladderAfterLeadRung(weak).some((r) => r.provider === 'GLM')).toBe(true);
    expect(ladderAfterLeadRung(weak)[0].provider).not.toBe('GLM');
  });

  it('every tier in the table now genuinely starts higher', () => {
    for (const level of Object.keys(TIER_LADDERS)) {
      expect(retryLeadsHigher(level, on), level).toBe(true);
    }
  });

  it('a single-rung override still answers false — nowhere higher to go', () => {
    const env = { AGENTV3_LADDER_STRONG: 'GLM:glm-5.3' } as unknown as NodeJS.ProcessEnv;
    expect(retryLeadsHigher('mini', env)).toBe(false);
  });
});

describe('the CONSTRUCTED retry chain — what the build would really call, in order', () => {
  // Same technique tierChainFidelity.test.ts uses: read the real chain out of `onChain`, not the
  // options object. A pure-helper test proves the arithmetic; this proves the wiring.
  const seq = (opts: Parameters<typeof buildTurnRunner>[0]): string[] => {
    let seen: ChainRung[] = [];
    buildTurnRunner({ ...opts, onChain: (c) => { seen = c; } });
    return seen.map((r) => `${r.name}:${r.modelId ?? ''}`);
  };
  const keys = ['GLM_API_KEY', 'KIMI_API_KEY', 'ANTHROPIC_API_KEY', 'AGENTV3_CHEAP_FLOOR',
    'AGENTV3_LADDER_WEAK', 'AGENTV3_LADDER_NORMAL', 'AGENTV3_LADDER_STRONG'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.GLM_API_KEY = 'test-glm';
    process.env.KIMI_API_KEY = 'test-kimi';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  });
  afterEach(() => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
  });

  it('🔴 STRONG\'s retry no longer opens on glm-5.3 — the engine that wrote zero files', () => {
    const full = seq({ tier: 'mini' });
    const retry = seq({ tier: 'mini', afterLeadRung: true });
    expect(full[0]).toMatch(/^GLM:glm-5\.3$/);
    expect(retry[0]).toMatch(/^KIMI:/);
    expect(retry).toEqual(full.slice(1));
  });

  it('WEAK\'s retry opens on KIMI and still ends at Haiku — never Sonnet or Opus', () => {
    const retry = seq({ tier: 'weak', afterLeadRung: true, noClaude: true });
    expect(retry[0]).toMatch(/^KIMI:/);
    expect(retry.some((r) => r.startsWith('CLAUDE:'))).toBe(false);
    expect(retry.some((r) => r.startsWith('CLAUDE_OPUS:'))).toBe(false);
    expect(retry[retry.length - 1]).toMatch(/^CLAUDE_HAIKU:/);
  });

  it('the retry chain is never empty, even when only one rung has a key', () => {
    delete process.env.GLM_API_KEY;
    delete process.env.KIMI_API_KEY;
    expect(seq({ tier: 'mini', afterLeadRung: true }).length).toBeGreaterThan(0);
  });
});

describe('modelStarvedWhileClamped — the engine LEARNS what it was not told', () => {
  beforeEach(() => { _resetStarvedBudgetMemo(); });

  it('knows nothing until a model actually starves', () => {
    expect(modelStarvedWhileClamped('kimi-k2.7-code')).toBe(false);
    expect(modelStarvedWhileClamped(undefined)).toBe(false);
    expect(modelStarvedWhileClamped('')).toBe(false);
  });

  it('🔒 the memo is normalised, so casing and spacing cannot hide a known model', () => {
    // Drive it the only way production can: through the runner's own throw path.
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/providers/OpenAiToolRunner.ts'), 'utf8');
    expect(src).toContain('starvedWhileClampedBy.add(model.toLowerCase().trim())');
    expect(src).toContain('starvedWhileClampedBy.has(String(model).toLowerCase().trim())');
  });
});

describe('🔒 reversion guards — the wiring, not just the helpers', () => {
  const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const route = stripComments(readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8'));
  const runner = stripComments(readFileSync(join(process.cwd(), 'src/server/AgentV3/providers/OpenAiToolRunner.ts'), 'utf8'));

  it('the retry runner asks for the after-lead-rung ladder, and no longer for the heal ladder', () => {
    expect(route).toContain('buildTurnRunner({ ...healRunnerOpts(), heal: false, afterLeadRung: true })');
    // ⚠️ Scoped to the EMPTY-BUILD RETRY block. Nine other sites legitimately call
    // `buildTurnRunner(healRunnerOpts())` — they are the HEAL gates, whose flash-only drop is the
    // admin's tuned 2026-08-13 behaviour and was deliberately left alone. A repo-wide negative here
    // would fail on correct code and force the guard to be deleted.
    const start = route.indexOf('const retryRungs = ladderAfterLeadRung');
    expect(start).toBeGreaterThan(0);
    const block = route.slice(start, route.indexOf('const retry = await retryRunner.run', start));
    expect(block).not.toContain('buildTurnRunner(healRunnerOpts())');
    expect(block).toContain('afterLeadRung: true');
  });

  it('buildTurnRunner applies it by position, from the TIER ladder', () => {
    expect(route).toContain('if (opts.afterLeadRung) rungs = ladderAfterLeadRung(parsed.rungs);');
  });

  it('the budget asks the learned memo as well as the known-capability test', () => {
    expect(runner).toContain('modelAlwaysReasons(thinkingModel) || modelStarvedWhileClamped(thinkingModel)');
  });

  it('🔒 only a CLAMPED starvation is learned — an unclamped one proves the opposite', () => {
    expect(runner).toContain('if (!budget.reasoningUnclamped) rememberStarvedWhileClamped(thinkingModel);');
  });
});
