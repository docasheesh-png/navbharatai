import { describe, it, expect } from 'vitest';
import {
  TIER_LADDERS, tierLadder, parseLadderOverride, healLadder, ladderFrom, escalationProvider,
  availableRungs, tierEngineAvailable, describeLadder, ladderEnvName, keyEnvFor, escalationPathForTier, PLAN_RUNG, planLadder,
} from '../src/server/AgentV3/tierLadder';
import { POWER_LEVELS_ORDERED } from '../src/server/AgentV3/powerGating';

const seq = (rungs: readonly { provider: string; model: string }[]): string[] => rungs.map((r) => `${r.provider}:${r.model}`);

/**
 * "user ne agar teeno mode me se jo select kiya hai, aap 100% usi mode me bane." (admin 2026-09-14)
 * The ladder IS the policy, so the policy is asserted literally — rung for rung, in order.
 */
describe('the three ladders, exactly as the admin listed them', () => {
  it('WEAK: glm-5.3-flash → kimi-k2.6 → glm-5.3 → Haiku (Haiku last, as the 2026-07-13 amendment said)', () => {
    expect(seq(TIER_LADDERS.weak)).toEqual(['GLM:glm-5.3-flash', 'KIMI:kimi-k2.6', 'GLM:glm-5.3', 'CLAUDE_HAIKU:haiku']);
    expect(TIER_LADDERS.weak[TIER_LADDERS.weak.length - 1].provider).toBe('CLAUDE_HAIKU');
  });
  it('NORMAL: glm-5.3-flash → kimi-k2.7-code → glm-5.3 → Sonnet', () => {
    expect(seq(TIER_LADDERS.off)).toEqual(['GLM:glm-5.3-flash', 'KIMI:kimi-k2.7-code', 'GLM:glm-5.3', 'CLAUDE:sonnet']);
  });
  it('STRONG: glm-5.3 → Sonnet → Opus, with Opus LAST ("Opus sirf zarurat par")', () => {
    expect(seq(TIER_LADDERS.mini)).toEqual(['GLM:glm-5.3', 'CLAUDE:sonnet', 'CLAUDE_OPUS:opus']);
    expect(TIER_LADDERS.mini[TIER_LADDERS.mini.length - 1].provider).toBe('CLAUDE_OPUS');
  });
  it('every selectable tier has a ladder, and no ladder names Grok, Gemini, Vertex or OpenAI', () => {
    for (const level of POWER_LEVELS_ORDERED) {
      expect(TIER_LADDERS[level].length).toBeGreaterThan(0);
      for (const r of TIER_LADDERS[level]) expect(['GROK', 'GEMINI', 'VERTEX', 'OPENAI']).not.toContain(r.provider);
    }
  });
  it('the known-weak glm-4.7-flash and the unverified kimi-k3 / gpt-5.4 are on no ladder', () => {
    for (const level of POWER_LEVELS_ORDERED) {
      for (const r of TIER_LADDERS[level]) expect(['glm-4.7-flash', 'kimi-k3', 'gpt-5.4']).not.toContain(r.model);
    }
  });
  it('every tier keeps a second vendor below its leader, except Strong which has Anthropic under GLM', () => {
    expect(new Set(TIER_LADDERS.weak.map((r) => r.provider)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(TIER_LADDERS.off.map((r) => r.provider)).size).toBeGreaterThanOrEqual(3);
    expect(TIER_LADDERS.mini.map((r) => r.provider)).toEqual(['GLM', 'CLAUDE', 'CLAUDE_OPUS']);
  });
  it('🔒 the WEAK ladder never carries Sonnet or Opus (absolute rule)', () => {
    for (const r of TIER_LADDERS.weak) expect(['CLAUDE', 'CLAUDE_OPUS']).not.toContain(r.provider);
  });
});

describe('overrides are applied whole or not at all', () => {
  it('a valid override replaces the ladder', () => {
    const p = parseLadderOverride('off', 'GLM:glm-5.3-flash, SONNET');
    expect(p.source).toBe('env');
    expect(seq(p.rungs)).toEqual(['GLM:glm-5.3-flash', 'CLAUDE:sonnet']);
    expect(p.rejected).toBeUndefined();
  });
  it('an unknown provider rejects the WHOLE override and names the env var', () => {
    const p = parseLadderOverride('off', 'KIMI:kimi-k2.7-code,BANANA:x');
    expect(p.source).toBe('default');
    expect(seq(p.rungs)).toEqual(seq(TIER_LADDERS.off));
    expect(p.rejected).toContain(ladderEnvName('off'));
    expect(p.rejected).toContain('BANANA');
  });
  it('🔒 a WEAK override naming Sonnet or Opus is refused, so an env var cannot break the absolute rule', () => {
    for (const bad of ['SONNET', 'CLAUDE:sonnet', 'OPUS', 'GLM:glm-4.7-flash,CLAUDE_OPUS:opus']) {
      const p = parseLadderOverride('weak', bad);
      expect(p.source).toBe('default');
      expect(p.rejected).toMatch(/never run on weak/i);
      expect(seq(p.rungs)).toEqual(seq(TIER_LADDERS.weak));
    }
    // …while Haiku on weak is the authorised exception and parses fine.
    expect(parseLadderOverride('weak', 'GLM:glm-5.3-flash,HAIKU').source).toBe('env');
  });
  it('empty / whitespace means "no override"', () => {
    for (const v of [undefined, '', '   ']) expect(parseLadderOverride('mini', v).source).toBe('default');
  });
  it('tierLadder reads the tier-specific env var and normalises legacy tier keys', () => {
    const env = { AGENTV3_LADDER_STRONG: 'KIMI:kimi-k3,OPUS' } as NodeJS.ProcessEnv;
    expect(seq(tierLadder('mini', env).rungs)).toEqual(['KIMI:kimi-k3', 'CLAUDE_OPUS:opus']);
    expect(seq(tierLadder('max', env).rungs)).toEqual(['KIMI:kimi-k3', 'CLAUDE_OPUS:opus']); // retired key → Strong
    expect(seq(tierLadder('off', env).rungs)).toEqual(seq(TIER_LADDERS.off));                // untouched
  });
});

describe('heal, escalation and availability derive from the ladder — never from another tier', () => {
  it('a heal drops the leading rung ONLY when it is the known-weak glm-4.7-flash', () => {
    // 5.3-flash leads every ladder now and is strong enough to repair its own work with the error in hand.
    expect(seq(healLadder(TIER_LADDERS.weak))).toEqual(seq(TIER_LADDERS.weak));
    expect(seq(healLadder(TIER_LADDERS.off))).toEqual(seq(TIER_LADDERS.off));
    // An override that puts 4.7-flash back in front still heals from rung 2…
    expect(seq(healLadder([{ provider: 'GLM', model: 'glm-4.7-flash' }, { provider: 'KIMI', model: 'kimi-k2.6' }]))).toEqual(['KIMI:kimi-k2.6']);
    // …and never empties.
    expect(seq(healLadder([{ provider: 'GLM', model: 'glm-4.7-flash' }]))).toEqual(['GLM:glm-4.7-flash']);
  });
  it('escalation is "start this ladder higher up": Normal → Sonnet, Strong → Opus, Weak → none', () => {
    expect(escalationProvider(TIER_LADDERS.off)).toBe('CLAUDE');
    expect(escalationProvider(TIER_LADDERS.mini)).toBe('CLAUDE_OPUS');
    expect(escalationProvider(TIER_LADDERS.weak)).toBeNull();
    expect(seq(ladderFrom(TIER_LADDERS.mini, 'CLAUDE_OPUS'))).toEqual(['CLAUDE_OPUS:opus']);
    expect(seq(ladderFrom(TIER_LADDERS.off, 'CLAUDE'))).toEqual(['CLAUDE:sonnet']);
    expect(seq(ladderFrom(TIER_LADDERS.mini, 'CLAUDE'))).toEqual(['CLAUDE:sonnet', 'CLAUDE_OPUS:opus']);
    expect(ladderFrom(TIER_LADDERS.weak, 'CLAUDE_OPUS')).toEqual([]);
  });
  it('a keyless rung is skipped; a tier with no keyed rung is unavailable, never substituted', () => {
    const onlyKimi = { KIMI_API_KEY: 'k' } as NodeJS.ProcessEnv;
    expect(seq(availableRungs(TIER_LADDERS.off, onlyKimi))).toEqual(['KIMI:kimi-k2.7-code']);
    expect(seq(availableRungs(TIER_LADDERS.mini, onlyKimi))).toEqual([]); // Strong has no Kimi rung
    expect(tierEngineAvailable('off', onlyKimi)).toBe(true);
    expect(tierEngineAvailable('mini', { ANTHROPIC_API_KEY: ' ' } as NodeJS.ProcessEnv)).toBe(false); // whitespace ≠ set
    expect(tierEngineAvailable('weak', {} as NodeJS.ProcessEnv)).toBe(false);
  });
  it('each provider maps to exactly the key that unlocks it', () => {
    expect(keyEnvFor('GLM')).toBe('GLM_API_KEY');
    expect(keyEnvFor('KIMI')).toBe('KIMI_API_KEY');
    expect(keyEnvFor('OPENAI')).toBe('OPENAI_API_KEY');
    for (const c of ['CLAUDE', 'CLAUDE_HAIKU', 'CLAUDE_OPUS'] as const) expect(keyEnvFor(c)).toBe('ANTHROPIC_API_KEY');
  });
  it('describeLadder names models for the cheap rungs and only the rung for Claude', () => {
    expect(describeLadder(TIER_LADDERS.mini)).toBe('GLM(glm-5.3) → CLAUDE → CLAUDE_OPUS');
  });
});

describe('escalation stays inside the tier', () => {
  it('weak never escalates — a single-tier path whatever the analyser said', () => {
    expect(escalationPathForTier('weak', ['gemini', 'haiku', 'sonnet'])).toEqual(['gemini']);
  });
  it('normal is capped at Sonnet: an opus entry is dropped, the climb below it is kept', () => {
    expect(escalationPathForTier('off', ['haiku', 'sonnet'])).toEqual(['haiku', 'sonnet']);
    expect(escalationPathForTier('off', ['haiku', 'sonnet', 'opus'])).toEqual(['haiku', 'sonnet']);
    expect(escalationPathForTier('off', ['opus'])).toEqual(['opus'].slice(0, 1)); // never empty
  });
  it('strong ends at Opus, with Sonnet before it, even from a one-tier pinned path', () => {
    expect(escalationPathForTier('mini', ['sonnet'])).toEqual(['sonnet', 'opus']);
    expect(escalationPathForTier('mini', ['haiku', 'sonnet'])).toEqual(['haiku', 'sonnet', 'opus']);
    expect(escalationPathForTier('mini', ['haiku'])).toEqual(['haiku', 'sonnet', 'opus']);
    expect(escalationPathForTier('max', ['sonnet'])).toEqual(['sonnet', 'opus']); // retired key → Strong
  });
  it('no analyser path → no escalation', () => {
    expect(escalationPathForTier('mini', undefined)).toEqual([]);
    expect(escalationPathForTier('off', [])).toEqual([]);
  });
});

describe('the plan phase runs on the tier\'s best cheap reasoner, then its own ladder', () => {
  it('plan rungs per tier — never Opus, never Grok, never Sonnet (input-heavy call, cheapest good reasoner)', () => {
    expect(PLAN_RUNG.weak).toEqual({ provider: 'GLM', model: 'glm-5.3-flash' });
    expect(PLAN_RUNG.off).toEqual({ provider: 'GLM', model: 'glm-5.3-flash' });
    expect(PLAN_RUNG.mini).toEqual({ provider: 'GLM', model: 'glm-5.3' });
    for (const r of Object.values(PLAN_RUNG)) expect(r.provider).not.toBe('CLAUDE_OPUS');
  });
  it('the plan chain is the plan rung followed by the tier ladder minus that rung — no other tier\'s model', () => {
    expect(seq(planLadder('weak'))).toEqual(['GLM:glm-5.3-flash', 'KIMI:kimi-k2.6', 'GLM:glm-5.3', 'CLAUDE_HAIKU:haiku']);
    expect(seq(planLadder('off'))).toEqual(['GLM:glm-5.3-flash', 'KIMI:kimi-k2.7-code', 'GLM:glm-5.3', 'CLAUDE:sonnet']);
    expect(seq(planLadder('mini'))).toEqual(['GLM:glm-5.3', 'CLAUDE:sonnet', 'CLAUDE_OPUS:opus']);
    expect(seq(planLadder('max'))).toEqual(seq(planLadder('mini')));
  });
  it('🔒 a weak plan never reaches Sonnet/Opus', () => {
    for (const r of planLadder('weak')) expect(['CLAUDE', 'CLAUDE_OPUS']).not.toContain(r.provider);
  });
});
