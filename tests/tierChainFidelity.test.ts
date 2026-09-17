import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTurnRunner, ladderRunners, enforceNoClaude } from '../src/server/routes/agentv3';
import { TIER_LADDERS, healLadder } from '../src/server/AgentV3/tierLadder';
import { sonnetModel, opusModel, haikuModel } from '../src/server/AgentV3/models';
import type { ChainRung } from '../src/server/AgentV3/runnerChainSummary';

/**
 * "user ne agar teeno mode me se jo select kiya hai, aap 100% usi mode me bane." (admin 2026-09-14)
 *
 * This suite asserts the CONSTRUCTED chain — the runners a build would actually call, in order —
 * against the tier's ladder. Not the options object, not a flag: the real (name, model) sequence.
 * That is what makes "usi mode mein" a property of the code rather than of a comment.
 */
const ENV_KEYS = [
  'AGENTV3_CHEAP_FLOOR', 'GLM_API_KEY', 'KIMI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'AGENTV3_LADDER_WEAK', 'AGENTV3_LADDER_NORMAL', 'AGENTV3_LADDER_STRONG', 'AGENTV3_DISABLE_HAIKU_BACKSTOP',
  'GLM_MODEL', 'KIMI_MODEL', 'AGENTV3_FREE_GLM_MODEL', 'AGENTV3_FREE_KIMI_MODEL',
] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.GLM_API_KEY = 'test-glm';
  process.env.KIMI_API_KEY = 'test-kimi';
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
});

/** The chain a build would run, captured from the same `onChain` hook the build report reads. */
function chainFor(opts: Parameters<typeof buildTurnRunner>[0]): ChainRung[] {
  let seen: ChainRung[] = [];
  buildTurnRunner({ ...opts, onChain: (c) => { seen = c; } });
  return seen;
}
const seq = (chain: ChainRung[]): string[] => chain.map((r) => `${r.name}:${r.modelId ?? ''}`);
const ladderSeq = (rungs: readonly { provider: string; model: string }[]): string[] => rungs.map((r) => {
  const model = r.model === 'sonnet' ? sonnetModel() : r.model === 'opus' ? opusModel() : r.model === 'haiku' ? haikuModel() : r.model;
  return `${r.provider}:${model}`;
});

describe('the constructed chain IS the tier ladder', () => {
  it('WEAK: exactly its five rungs, in order, and nothing else', () => {
    expect(seq(chainFor({ tier: 'weak', noClaude: true }))).toEqual(ladderSeq(TIER_LADDERS.weak));
  });
  it('NORMAL: glm-5.3-flash → kimi-k2.7-code-highspeed → glm-5.3 → Sonnet', () => {
    expect(seq(chainFor({ tier: 'off' }))).toEqual(ladderSeq(TIER_LADDERS.off));
  });
  it('STRONG: glm-5.3 → kimi-k3 → Sonnet → Opus, Opus last', () => {
    const chain = chainFor({ tier: 'mini' });
    expect(seq(chain)).toEqual(ladderSeq(TIER_LADDERS.mini));
    expect(chain[chain.length - 1].name).toBe('CLAUDE_OPUS');
  });
  it('🔴 no tier ever carries Vertex, Gemini, Grok or Bedrock as a build rung', () => {
    for (const tier of ['weak', 'off', 'mini'] as const) {
      for (const r of chainFor({ tier, noClaude: tier === 'weak' })) {
        expect(r.name).not.toMatch(/VERTEX|GEMINI|GROK|BEDROCK/);
      }
    }
  });
  it('a retired tier key builds on Strong (never silently on Normal)', () => {
    expect(seq(chainFor({ tier: 'max' }))).toEqual(ladderSeq(TIER_LADDERS.mini));
    expect(seq(chainFor({ tier: 'medium' }))).toEqual(ladderSeq(TIER_LADDERS.mini));
  });
});

describe('a missing key removes a rung — it never substitutes another tier\'s model', () => {
  it('Normal with only a Kimi key runs Kimi alone', () => {
    delete process.env.GLM_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    expect(seq(chainFor({ tier: 'off' }))).toEqual(['KIMI:kimi-k2.7-code-highspeed']);
  });
  it('Strong without a GLM key still has ITS OWN Kimi rung (added 2026-09-16) — kimi-k3 → Sonnet → Opus', () => {
    delete process.env.GLM_API_KEY;
    expect(seq(chainFor({ tier: 'mini' }))).toEqual(['KIMI:kimi-k3', `CLAUDE:${sonnetModel()}`, `CLAUDE_OPUS:${opusModel()}`]);
  });
  it('Strong with neither a GLM nor a Kimi key runs Sonnet → Opus alone', () => {
    delete process.env.GLM_API_KEY; delete process.env.KIMI_API_KEY;
    expect(seq(chainFor({ tier: 'mini' }))).toEqual([`CLAUDE:${sonnetModel()}`, `CLAUDE_OPUS:${opusModel()}`]);
  });
  it('Weak without GLM/Kimi keys still never reaches Sonnet — Haiku alone', () => {
    delete process.env.GLM_API_KEY; delete process.env.KIMI_API_KEY;
    expect(seq(chainFor({ tier: 'weak', noClaude: true }))).toEqual([`CLAUDE_HAIKU:${haikuModel()}`]);
  });
  it('🔴 a tier with NO keyed rung yields an honest refusal, not a borrowed engine', async () => {
    for (const k of ['GLM_API_KEY', 'KIMI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
    const runner = buildTurnRunner({ tier: 'off' });
    await expect(runner.runTurn({ system: '', messages: [], tools: [] } as never)).rejects.toThrow(/Normal engine is not available/);
    // …and the refusal names no vendor (White-Label Law).
    await expect(runner.runTurn({ system: '', messages: [], tools: [] } as never)).rejects.not.toThrow(/glm|kimi|claude|anthropic|openai|gpt|sonnet/i);
  });
  it('AGENTV3_CHEAP_FLOOR=off is still the kill switch for the GLM/Kimi rungs only', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'off';
    expect(seq(chainFor({ tier: 'off' }))).toEqual([`CLAUDE:${sonnetModel()}`]);
    expect(seq(chainFor({ tier: 'mini' }))).toEqual([`CLAUDE:${sonnetModel()}`, `CLAUDE_OPUS:${opusModel()}`]);
  });
});

describe('heal and escalation move WITHIN the ladder', () => {
  // 🔴 CHANGED 2026-09-17 WITH THE LEAD RUNG, AND THE OLD NAME SAID WHY IT HAD TO. This case used to
  // read "5.3-flash leads and can repair its own work" and asserted Normal's heal chain was the WHOLE
  // ladder — true only while the lead rung was one `healLadder` does not drop. With glm-4.7-flashx
  // leading, the 2026-08-13 rule ("a repair must not begin on the model that produced the failing
  // app") applies again on BOTH tiers, so both heal chains drop their leading rung and open on KIMI.
  // Asserted against `healLadder(...)` rather than a hand-written list, so the two can never drift.
  it('a heal drops the cheap leading flash rung and opens on a different vendor', () => {
    expect(seq(chainFor({ tier: 'weak', heal: true, noClaude: true }))).toEqual(ladderSeq(healLadder(TIER_LADDERS.weak)));
    expect(seq(chainFor({ tier: 'off', heal: true }))).toEqual(ladderSeq(healLadder(TIER_LADDERS.off)));
    // …and "opens on a different vendor" is the POINT, not a side effect — pinned explicitly so a
    // future lead-rung change that happens to keep GLM first fails here instead of silently
    // reinstating "repair on the model that just broke it".
    expect(seq(chainFor({ tier: 'weak', heal: true, noClaude: true }))[0]).toMatch(/^KIMI:/);
    expect(seq(chainFor({ tier: 'off', heal: true }))[0]).toMatch(/^KIMI:/);
  });
  it('escalating Strong to Opus starts its OWN ladder at Opus', () => {
    expect(seq(chainFor({ tier: 'mini', fromProvider: 'CLAUDE_OPUS' }))).toEqual([`CLAUDE_OPUS:${opusModel()}`]);
  });
  it('escalating Normal to "Sonnet" starts at its Sonnet rung — Opus is not on Normal\'s ladder', () => {
    expect(seq(chainFor({ tier: 'off', fromProvider: 'CLAUDE' }))).toEqual([`CLAUDE:${sonnetModel()}`]);
    // Asking Normal for Opus is a no-op: the ladder has no such rung, so the full ladder stands.
    expect(seq(chainFor({ tier: 'off', fromProvider: 'CLAUDE_OPUS' }))).toEqual(ladderSeq(TIER_LADDERS.off));
  });
});

describe('🔒 the weak-module guard, on the FINAL chain', () => {
  it('a Weak override that smuggles Sonnet is refused at parse time — the chain is the code default', () => {
    process.env.AGENTV3_LADDER_WEAK = 'GLM:glm-5.3-flash,SONNET';
    expect(seq(chainFor({ tier: 'weak', noClaude: true }))).toEqual(ladderSeq(TIER_LADDERS.weak));
  });
  it('enforceNoClaude strips CLAUDE and CLAUDE_OPUS alike, and keeps Haiku IN ITS LADDER POSITION', () => {
    // The guard decides WHAT may run on weak; the ladder decides WHERE. The admin's weak ladder puts
    // GPT-5.4 after Haiku, so a "move Haiku last" here would silently override that list.
    const chain = [
      { name: 'CLAUDE_HAIKU' }, { name: 'CLAUDE' }, { name: 'GLM' }, { name: 'CLAUDE_OPUS' }, { name: 'KIMI' },
    ];
    expect(enforceNoClaude(chain, true).map((r) => r.name)).toEqual(['CLAUDE_HAIKU', 'GLM', 'KIMI']);
    expect(enforceNoClaude(chain, false).map((r) => r.name)).toEqual(['CLAUDE_HAIKU', 'CLAUDE', 'GLM', 'CLAUDE_OPUS', 'KIMI']);
  });
  it('even if Strong\'s ladder is forced through the guard, no Sonnet/Opus survives', () => {
    // Strong gained its own Kimi rung (kimi-k3) on 2026-09-16 — enforceNoClaude never touches GLM/KIMI,
    // only CLAUDE/CLAUDE_OPUS, so both non-Claude rungs of Strong's ladder survive the guard.
    const names = chainFor({ tier: 'mini', noClaude: true }).map((r) => r.name);
    expect(names).toEqual(['GLM', 'KIMI']);
  });
});

describe('every build-chain call site passes a tier — the wiring, asserted', () => {
  const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  it('no caller still passes the retired five-boolean assembly', () => {
    const calls = [...route.matchAll(/buildTurnRunner\(\{[^}]*?\}/gs)].map((m) => m[0]);
    // Only the inline-object calls match this shape (the heal sites go through healRunnerOpts(), which
    // tests/healRunnerAttribution.test.ts pins to the tier separately).
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) {
      // ⚠️ A SPREAD OF `healRunnerOpts()` SUPPLIES THE TIER (2026-09-17). The empty-build retry now
      // reads `buildTurnRunner({ ...healRunnerOpts(), heal: false, afterLeadRung: true })`, so it has
      // no literal `tier:` — but it is guaranteed one, by the same route this case's own comment
      // already exempts the heal sites through (healRunnerOpts sets `tier: powerLevelReqEffective`,
      // pinned in tests/healRunnerAttribution.test.ts). Widened to accept that spread rather than
      // dropped: the invariant — every call site passes a tier — is unchanged and still enforced.
      expect(c).toMatch(/\btier:|\.\.\.healRunnerOpts\(\)/);
      expect(c).not.toMatch(/allowCheapFloor|cheapOnly:|claudeFirst:|geminiModel:|\bfree:|flagship:/);
    }
  });
  it('ladderRunners knows every provider the ladder type can name', () => {
    // A new LadderProvider without a case here would silently vanish from every chain.
    const all = ladderRunners([
      { provider: 'GLM', model: 'x' }, { provider: 'KIMI', model: 'x' }, { provider: 'OPENAI', model: 'x' },
      { provider: 'CLAUDE', model: 'sonnet' }, { provider: 'CLAUDE_HAIKU', model: 'haiku' }, { provider: 'CLAUDE_OPUS', model: 'opus' },
    ]).map((r) => r.name);
    expect(all).toEqual(['GLM', 'KIMI', 'OPENAI', 'CLAUDE', 'CLAUDE_HAIKU', 'CLAUDE_OPUS']);
  });
});
