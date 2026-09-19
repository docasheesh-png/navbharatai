// Nemotron 3 goes exactly where it pays, and NOWHERE else (admin 2026-09-19: "kaha jahan hame fayda
// hai. banao.").
//
// THE THREE PLACES, and the one reason behind all three: a single, input-heavy REASONING call with no
// tools and nothing repeated for a prompt cache to rescue.
//   judge  → Ultra. On the measured profile the judge is 78% of a cheap-lead build's real cost.
//   plan   → Ultra. One short input-heavy call, flagged because it happens on EVERY build.
//   rung   → Super, in front of the Claude backstop on Weak and Normal. Keyed, not flagged.
//
// AND THE PLACES IT MUST NEVER REACH — asserted here so a later change has to argue with a test:
// the architect, the sub-agents, the reviewer and the heal passes (cached tool loops, where Super is
// 6.2× DEARER than glm-4.7-flashx), vision (Nemotron 3 is text-only), and the guards (deterministic
// code at ₹0).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  nemotronKey, nemotronConfigured, nemotronHardOff, nemotronTierAllowed, nemotronRungOk,
  nemotronAllowedFor, nemotronUltraModel, nemotronSuperModel, nemotronBaseUrl,
  NEMOTRON_ULTRA_DEFAULT, NEMOTRON_SUPER_DEFAULT,
} from '../src/server/AgentV3/nemotron';
import { TIER_LADDERS, planLadder, keyEnvFor, parseLadderOverride, healLadder } from '../src/server/AgentV3/tierLadder';
import { realRateFor } from '../src/server/AgentV3/providerRates';
import { resolveJudgeKind, ladderRunners } from '../src/server/routes/agentv3';
import { redactProvidersText, hasProviderLeak } from '../src/server/lib/providerRedaction';

const KEYS = ['NEMOTRON_API_KEY', 'AGENTV3_NEMOTRON', 'NEMOTRON_BASE_URL', 'NEMOTRON_ULTRA_MODEL',
  'NEMOTRON_SUPER_MODEL', 'GLM_API_KEY', 'KIMI_API_KEY', 'ANTHROPIC_API_KEY', 'AGENTV3_CHEAP_FLOOR',
  'RATE_NEMOTRON_ULTRA_IN', 'RATE_NEMOTRON_SUPER_IN'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; } });

const seq = (r: readonly { provider: string; model: string }[]) => r.map((x) => `${x.provider}:${x.model}`);
const ON = (t = 'on') => ({ NEMOTRON_API_KEY: 'k', AGENTV3_NEMOTRON: t } as NodeJS.ProcessEnv);

describe('🔒 with NO key, everything is byte-identical to before this existed', () => {
  it('no key ⇒ nothing is configured, no role is allowed, no rung runs', () => {
    expect(nemotronConfigured({})).toBe(false);
    expect(nemotronRungOk({})).toBe(false);
    for (const tier of ['weak', 'off', 'mini'] as const) {
      for (const role of ['judge', 'plan', 'rung'] as const) {
        expect(nemotronAllowedFor(role, tier, {}), `${role}/${tier}`).toBe(false);
      }
    }
  });

  it('the keyless ladder skips the rung, so Weak ends GLM → KIMI → GLM → Haiku exactly as before', () => {
    process.env.GLM_API_KEY = 'g'; process.env.KIMI_API_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'a';
    expect(ladderRunners(TIER_LADDERS.weak).some((r) => r.name === 'NEMOTRON')).toBe(false);
    expect(ladderRunners(TIER_LADDERS.off).some((r) => r.name === 'NEMOTRON')).toBe(false);
  });

  it('the keyless plan chain is the tier table, untouched', () => {
    expect(seq(planLadder('weak', {}))[0]).toBe('GLM:glm-4.7-flashx');
    expect(seq(planLadder('mini', {}))[0]).toBe('GLM:glm-5.3');
  });

  it('the keyless judge is whatever it is today — never nemotron', () => {
    expect(resolveJudgeKind('paid', 'grok-key', undefined, 'glm-key', false)).toBe('glm');
    expect(resolveJudgeKind('power', 'grok-key', undefined, 'glm-key', false)).toBe('grok');
    expect(resolveJudgeKind('paid', undefined, undefined, undefined, false)).toBe('sonnet');
  });

  it('a whitespace-only key counts as unset — the BRAVE_API_KEY lesson', () => {
    for (const bad of ['', '   ', '\n', '\t ']) {
      expect(nemotronConfigured({ NEMOTRON_API_KEY: bad }), JSON.stringify(bad)).toBe(false);
    }
    expect(nemotronKey({ NEMOTRON_API_KEY: '  sk-x  ' })).toBe('sk-x');
  });
});

describe('the judge — the 78% slice, and the safest place for an unproven vendor', () => {
  it('takes the judge on every tier the flag names', () => {
    expect(resolveJudgeKind('paid', 'g', undefined, 'glm', true)).toBe('nemotron');
    expect(resolveJudgeKind('power', 'g', undefined, 'glm', true)).toBe('nemotron');
    expect(resolveJudgeKind('free', 'g', undefined, 'glm', true)).toBe('nemotron');
  });

  it('🔒 AGENTV3_REVIEWER=sonnet still overrides EVERYTHING, Nemotron included', () => {
    expect(resolveJudgeKind('paid', 'g', 'sonnet', 'glm', true)).toBe('sonnet');
    expect(resolveJudgeKind('power', 'g', 'SONNET', 'glm', true)).toBe('sonnet');
  });

  it('falls back to today\'s judge when not allowed — never to a dearer one', () => {
    expect(resolveJudgeKind('paid', 'g', undefined, 'glm', false)).toBe('glm');
  });
});

describe('the flag is an allowlist, so the rollout can start on the tier WE pay for', () => {
  it('a single tier name allows that tier alone', () => {
    const env = ON('weak');
    expect(nemotronTierAllowed('weak', env)).toBe(true);
    expect(nemotronTierAllowed('off', env)).toBe(false);
    expect(nemotronTierAllowed('mini', env)).toBe(false);
  });

  it('accepts the words an admin would actually type, and a comma list', () => {
    expect(nemotronTierAllowed('weak', ON('free'))).toBe(true);
    expect(nemotronTierAllowed('off', ON('normal'))).toBe(true);
    expect(nemotronTierAllowed('mini', ON('strong'))).toBe(true);
    expect(nemotronTierAllowed('mini', ON('premium'))).toBe(true);
    const two = ON('weak, normal');
    expect([nemotronTierAllowed('weak', two), nemotronTierAllowed('off', two), nemotronTierAllowed('mini', two)])
      .toEqual([true, true, false]);
  });

  it('`on` means every tier', () => {
    for (const t of ['weak', 'off', 'mini'] as const) expect(nemotronTierAllowed(t, ON('on'))).toBe(true);
  });

  it('🔴 an UNRECOGNISED value means OFF, never everywhere — somebody who wanted all would type "on"', () => {
    // ⚠️ `yes` and `1` are NOT in this list, and my first draft of this case wrongly put them here.
    // They are the shared `parseEnvFlag` vocabulary's standard spellings for "yes", so treating them
    // as every-tier is consistent with every other flag in this repo. What belongs here is a genuine
    // typo — a value nobody meant.
    for (const bad of ['weakk', 'tier-1', '???', 'sonnet', 'nromal', 'week']) {
      expect(nemotronTierAllowed('weak', ON(bad)), bad).toBe(false);
      expect(nemotronTierAllowed('mini', ON(bad)), bad).toBe(false);
    }
  });

  it('every shared spelling of yes/no works, because the flag goes through parseEnvFlag', () => {
    // The hand-written truthy list this file first carried is exactly what tests/envFlag.test.ts
    // forbids — it caught it, and this case is what replaced it.
    for (const yes of ['on', 'true', '1', 'yes', 'y', 'enable', 'enabled', ' ON ']) {
      expect(nemotronTierAllowed('mini', ON(yes)), yes).toBe(true);
    }
    for (const no of ['off', 'false', '0', 'no', 'n', 'disable', 'disabled']) {
      expect(nemotronRungOk({ NEMOTRON_API_KEY: 'k', AGENTV3_NEMOTRON: no }), no).toBe(false);
      expect(nemotronTierAllowed('weak', ON(no)), no).toBe(false);
    }
  });

  it('⚠️ a KEY ALONE is not a feature switch — the AGENTV3_FILE_EMBEDDINGS defect, not repeated', () => {
    const keyOnly = { NEMOTRON_API_KEY: 'k' } as NodeJS.ProcessEnv;
    expect(nemotronConfigured(keyOnly)).toBe(true);
    expect(nemotronTierAllowed('weak', keyOnly)).toBe(false);   // judge: needs the flag
    expect(nemotronAllowedFor('plan', 'weak', keyOnly)).toBe(false);
    expect(nemotronRungOk(keyOnly)).toBe(true);                  // rung: keyed like every other rung
  });

  it('AGENTV3_NEMOTRON=off is the HARD kill — it removes the rung too', () => {
    const off = { NEMOTRON_API_KEY: 'k', AGENTV3_NEMOTRON: 'off' } as NodeJS.ProcessEnv;
    expect(nemotronHardOff(off)).toBe(true);
    expect(nemotronRungOk(off)).toBe(false);
    for (const t of ['weak', 'off', 'mini'] as const) expect(nemotronTierAllowed(t, off)).toBe(false);
  });
});

describe('the plan rung', () => {
  it('Ultra leads the plan chain on an allowed tier, and the tier ladder still follows', () => {
    const chain = seq(planLadder('weak', ON('weak')));
    expect(chain[0]).toBe('NEMOTRON:nemotron-ultra');
    expect(chain).toContain('GLM:glm-4.7-flashx');
  });

  it('🔒 a Weak plan still never reaches Sonnet or Opus', () => {
    for (const r of planLadder('weak', ON('on'))) expect(['CLAUDE', 'CLAUDE_OPUS']).not.toContain(r.provider);
  });

  it('an unallowed tier keeps its own plan rung', () => {
    expect(seq(planLadder('mini', ON('weak')))[0]).toBe('GLM:glm-5.3');
  });
});

describe('the ladder rung is INSURANCE, never the insurance itself', () => {
  it('Super sits in front of the Claude backstop on Weak and Normal — never in place of it', () => {
    for (const [tier, last] of [['weak', 'CLAUDE_HAIKU'], ['off', 'CLAUDE']] as const) {
      const rungs = TIER_LADDERS[tier];
      const nemo = rungs.findIndex((r) => r.provider === 'NEMOTRON');
      expect(nemo, `${tier} has no Nemotron rung`).toBeGreaterThan(-1);
      expect(rungs[rungs.length - 1].provider).toBe(last);
      expect(nemo).toBe(rungs.length - 2);
    }
  });

  it('STRONG is untouched — a premium build never opens on a 12B-active model', () => {
    expect(TIER_LADDERS.mini.some((r) => r.provider === 'NEMOTRON')).toBe(false);
  });

  it('🔒 it is never the LEAD rung on any tier — that is where it would be 6.2x dearer', () => {
    for (const t of ['weak', 'off', 'mini'] as const) {
      expect(TIER_LADDERS[t][0].provider).not.toBe('NEMOTRON');
    }
  });

  it('a heal still opens on a different vendor, and Nemotron did not become the heal opener', () => {
    expect(seq(healLadder(TIER_LADDERS.weak))[0]).toBe('KIMI:kimi-k2.7-code');
    expect(seq(healLadder(TIER_LADDERS.off))[0]).toBe('KIMI:kimi-k2.7-code-highspeed');
  });

  it('has its own key env, and an override may name it', () => {
    expect(keyEnvFor('NEMOTRON')).toBe('NEMOTRON_API_KEY');
    for (const word of ['NEMOTRON', 'NEMO', 'NVIDIA']) {
      const p = parseLadderOverride('off', `${word}:nemotron-ultra`);
      expect(p.source, word).toBe('env');
      expect(p.rungs[0].provider).toBe('NEMOTRON');
    }
  });

  it('🔒 a WEAK override still cannot smuggle Sonnet alongside it', () => {
    expect(parseLadderOverride('weak', 'NEMOTRON:nemotron-super,SONNET').source).toBe('default');
  });
});

describe('the rate card — a rung may never run unpriced', () => {
  it('prices both sizes, and the symbolic names the ladder uses', () => {
    expect(realRateFor('NEMOTRON', 'nemotron-ultra')).toEqual({ inputPerMTok: 0.5, outputPerMTok: 2.2 });
    expect(realRateFor('NEMOTRON', 'nemotron-super')).toEqual({ inputPerMTok: 0.15, outputPerMTok: 0.65 });
  });

  it('prices the REAL host ids too, slash and vendor prefix included', () => {
    expect(realRateFor('NEMOTRON', NEMOTRON_ULTRA_DEFAULT).inputPerMTok).toBe(0.5);
    expect(realRateFor('NEMOTRON', NEMOTRON_SUPER_DEFAULT).inputPerMTok).toBe(0.15);
    expect(realRateFor('NEMOTRON', 'nvidia/nemotron-3-super-120b-a12b:free').inputPerMTok).toBe(0.15);
  });

  it('🔴 NO CACHE LINE — the route does not honour cache markers, so cache-read bills at full input', () => {
    for (const m of ['nemotron-ultra', 'nemotron-super']) {
      expect(realRateFor('NEMOTRON', m).cacheReadPerMTok).toBeUndefined();
    }
  });

  it('an UNKNOWN Nemotron bills at the DEAREST line in the family, never the cheapest', () => {
    for (const m of ['nvidia/nemotron-3-nano-30b-a3b', 'nemotron-4-something', 'nemotron']) {
      expect(realRateFor('NEMOTRON', m).inputPerMTok, m).toBe(0.5);
    }
    expect(realRateFor('NEMOTRON', undefined).inputPerMTok).toBe(0.5);
  });

  it('does not fall through to the Sonnet default — a 6x over-statement of our own cost', () => {
    expect(realRateFor('NEMOTRON', NEMOTRON_ULTRA_DEFAULT).inputPerMTok).not.toBe(3);
  });
});

describe('🔒 WHITE-LABEL — the user never learns who answered', () => {
  it('scrubs the vendor, the model ids and every host it can be bought through', () => {
    for (const text of [
      'Provider NEMOTRON failed', 'nvidia/nemotron-3-ultra-550b-a55b returned nothing',
      'NVIDIA Nemotron could not answer', 'openrouter.ai/api/v1 timed out',
      'integrate.api.nvidia.com refused', 'deepinfra.com 429', 'api.together.ai unreachable',
    ]) {
      expect(hasProviderLeak(text), `not detected: ${text}`).toBe(true);
      expect(hasProviderLeak(redactProvidersText(text)), `survived scrubbing: ${text}`).toBe(false);
    }
  });
});

describe('🔴 the places Nemotron must NEVER reach', () => {
  const SRC = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const NEMO = readFileSync(join(__dirname, '..', 'src/server/AgentV3/nemotron.ts'), 'utf8');
  const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  it('the role list is CLOSED — a fourth role cannot appear without being named', () => {
    // `NemotronRole` is the boundary of "kahan". Widening it is the point at which somebody has to
    // decide whether the new role is a cached tool loop (never) or a single reasoning call (maybe).
    expect(codeOnly(NEMO)).toMatch(/export type NemotronRole = 'judge' \| 'plan' \| 'rung';/);
  });

  it('no builder, sub-agent, reviewer or heal path asks for Nemotron', () => {
    // The IMPORT line names the gates too, so it is excluded — what is being counted is CALL SITES.
    const code = codeOnly(SRC).split('\n').filter((l) => !/^import\s/.test(l.trim())).join('\n');
    // Exactly two gates may exist in this route: the ladder rung and the judge. A third is the
    // question this case exists to force somebody to answer out loud.
    const hits = (code.match(/nemotron(?:RungOk|TierAllowed|AllowedFor)\s*\(/gi) || []).length;
    expect(hits, 'a new Nemotron gate appeared — is it a cached tool loop?').toBeLessThanOrEqual(2);
    // And it is not wired into the heal or sub-agent ladders by name.
    expect(code).not.toMatch(/healLadder[^\n]*NEMOTRON/i);
  });

  it('vision is untouched — Nemotron 3 is text-only and cannot read an image', () => {
    expect(codeOnly(SRC)).not.toMatch(/vision[^\n]*nemotron|nemotron[^\n]*vision/i);
  });

  it('the runner sends NO vendor-specific thinking parameter — that would be a hard 400', () => {
    // Anchored inside `ladderRunners`, not on the first `case 'NEMOTRON':` in the file — the telemetry
    // label switches carry one each, and they are not where a request is built.
    const fn = SRC.indexOf('export function ladderRunners(');
    expect(fn, 'ladderRunners moved').toBeGreaterThan(-1);
    const at = SRC.indexOf("case 'NEMOTRON':", fn);
    expect(at).toBeGreaterThan(fn);
    const block = SRC.slice(at, SRC.indexOf("case 'CLAUDE':", at));
    expect(block).toContain("openAiCompatRunners('NEMOTRON'");
    expect(codeOnly(block)).not.toContain('thinkingControl');
  });
});

describe('model ids and host are env-overridable, because each host spells them differently', () => {
  it('defaults to the OpenRouter/Together form and OpenRouter\'s base URL', () => {
    expect(nemotronUltraModel({})).toBe(NEMOTRON_ULTRA_DEFAULT);
    expect(nemotronSuperModel({})).toBe(NEMOTRON_SUPER_DEFAULT);
    expect(nemotronBaseUrl({})).toContain('openrouter.ai');
  });

  it('an override wins, trimmed', () => {
    expect(nemotronUltraModel({ NEMOTRON_ULTRA_MODEL: ' nvidia.nemotron-3-ultra-v1 ' })).toBe('nvidia.nemotron-3-ultra-v1');
    expect(nemotronBaseUrl({ NEMOTRON_BASE_URL: ' https://api.together.xyz/v1 ' })).toBe('https://api.together.xyz/v1');
  });

  it('a blank override falls back to the default, never to an empty id', () => {
    expect(nemotronUltraModel({ NEMOTRON_ULTRA_MODEL: '   ' })).toBe(NEMOTRON_ULTRA_DEFAULT);
    expect(nemotronBaseUrl({ NEMOTRON_BASE_URL: '' })).toContain('openrouter.ai');
  });
});
