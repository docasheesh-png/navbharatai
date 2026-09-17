// 🔴 "A STRONGER MODEL" WAS A TEMPLATE, NOT A MEASUREMENT — autopsy f5351721, 2026-09-17.
//
// The empty-build retry told the user it was "rebuilding with a stronger model", told the admin report
// it had retried "on a stronger model (Sonnet in normal mode; Opus only in power mode)", and recorded
// the delivery as `sonnet`. In the build that produced this, **all 30 calls were `glm-5.3`** and no
// Claude rung ever ran. Three claims, one template, zero evidence.
//
// The cause is architectural drift: those sentences date from when a tier PINNED one model, so
// `resolveModel(tier)` really decided what ran. Under the three-tier ladders the CHAIN decides, and the
// retry passes `heal: true` → `healLadder`, which only drops a leading cheap-flash rung. Weak and
// Normal have one (so the claim was true there); **Strong does not** (so it was false).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { retryLeadsHigher, tierLadder, healLadder, TIER_LADDERS } from '../src/server/AgentV3/tierLadder';
import { deliveredStartTier } from '../src/server/routes/agentv3';

const on = {} as NodeJS.ProcessEnv;

describe('retryLeadsHigher — the claim, derived from the ladder that actually runs', () => {
  it('🔴 STRONG does NOT start higher — the exact case that made the old sentence false', () => {
    expect(retryLeadsHigher('mini', on)).toBe(false);
    // …and the reason, pinned so the answer cannot become right by accident: Strong has no flash rung,
    // so healLadder drops nothing and the retry restarts on the identical engine.
    const build = tierLadder('mini', on).rungs;
    expect(healLadder(build)[0]).toEqual(build[0]);
  });

  it('Weak and Normal DO start higher — their cheap flash lead is dropped', () => {
    for (const tier of ['weak', 'off'] as const) {
      expect(retryLeadsHigher(tier, on), tier).toBe(true);
      const build = tierLadder(tier, on).rungs;
      expect(healLadder(build)[0].model, tier).not.toBe(build[0].model);
    }
  });

  it('follows an env ladder override rather than the code table', () => {
    // A Strong override that DOES lead with a flash rung must flip the answer to true — proving the
    // helper reads the ladder in force, not a hard-coded fact about tier names.
    const env = { AGENTV3_LADDER_STRONG: 'GLM:glm-4.7-flashx,GLM:glm-5.3,SONNET' } as unknown as NodeJS.ProcessEnv;
    expect(retryLeadsHigher('mini', env)).toBe(true);
  });

  it('a one-rung ladder cannot start higher, and nothing throws', () => {
    const env = { AGENTV3_LADDER_STRONG: 'GLM:glm-5.3' } as unknown as NodeJS.ProcessEnv;
    expect(retryLeadsHigher('mini', env)).toBe(false);
    expect(retryLeadsHigher(undefined, on)).toBe(typeof retryLeadsHigher(undefined, on) === 'boolean' ? retryLeadsHigher(undefined, on) : false);
  });

  it('every tier in the table answers without throwing', () => {
    for (const level of Object.keys(TIER_LADDERS)) {
      expect(typeof retryLeadsHigher(level, on), level).toBe('boolean');
    }
  });
});

describe('deliveredStartTier — telemetry records what RAN, never a literal', () => {
  it('maps the Claude rungs to their own tiers', () => {
    expect(deliveredStartTier('CLAUDE_OPUS')).toBe('opus');
    expect(deliveredStartTier('CLAUDE')).toBe('sonnet');
    expect(deliveredStartTier('CLAUDE_HAIKU')).toBe('haiku');
  });

  it('🔴 a GLM/Kimi delivery is NOT filed as Sonnet — the corruption this fixes', () => {
    expect(deliveredStartTier('GLM')).toBe('gemini');
    expect(deliveredStartTier('KIMI')).toBe('gemini');
    expect(deliveredStartTier('GLM')).not.toBe('sonnet');
    expect(deliveredStartTier('KIMI')).not.toBe('sonnet');
  });

  it('case does not matter — the runner reports names in its own casing', () => {
    expect(deliveredStartTier('claude')).toBe('sonnet');
    expect(deliveredStartTier('glm')).toBe('gemini');
  });

  it('🔒 an unknown or absent provider yields undefined, so the caller keeps its value', () => {
    for (const bad of ['', '   ', undefined, 'SOMETHING_NEW']) {
      expect(deliveredStartTier(bad as string | undefined), String(bad)).toBeUndefined();
    }
  });
});

describe('🔒 reversion guards — the sentences themselves', () => {
  // ⚠️ COMMENTS ARE STRIPPED, and the first draft of these guards is why. Both files now carry a
  // comment QUOTING the old sentence as the thing that must not come back — so a raw substring search
  // matched the very explanation of the fix and failed. A guard that cannot tell code from prose would
  // also have to be deleted the next time someone documents a bug, which is the opposite of the point.
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const route = stripComments(readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8'));
  const runner = stripComments(readFileSync(join(process.cwd(), 'src/server/AgentV3/AgentRunner.ts'), 'utf8'));

  it('the runner no longer promises a retry it does not decide', () => {
    // AgentRunner cannot know whether the ROUTE will retry (`shouldRetryEmptyBuild`), nor whether that
    // retry would be stronger (`retryLeadsHigher`). It must state only what it observed.
    expect(runner).not.toContain('Retrying with a stronger model');
    expect(runner).toContain('(No files were created, so the build did not run.)');
  });

  it('the retry narration and the admin line are both branched on the derived answer', () => {
    expect(route).toContain('const retryIsStronger = retryLeadsHigher(powerLevelReqEffective);');
    // The unconditional claims are gone from the route entirely.
    expect(route).not.toContain('rebuilding with a stronger model');
    expect(route).not.toContain('Sonnet in normal mode; Opus only in power mode');
  });

  it('the delivered tier is measured, not assigned', () => {
    expect(route).toContain('deliveredTier = deliveredStartTier(dominantProvider(providerTurns)) ?? deliveredTier;');
    expect(route).not.toContain("deliveredTier = 'sonnet'; }");
  });

  // 🔒 WHITE-LABEL LAW. The retry is a surface every builder sees, so neither branch may name a vendor
  // or a model id. The "stronger" branch reuses the wording the escalation runner was already vetted on.
  it('neither user-facing branch names a vendor or a model', () => {
    // Just the two emitted strings — the admin diag line beside them legitimately prints the real
    // ladder via describeLadder(), and that surface is admin-only.
    const start = route.indexOf("text: retryIsStronger");
    expect(start).toBeGreaterThan(0);
    const emitted = route.slice(start, route.indexOf('ts: Date.now()', start));
    expect(emitted).toContain('stronger engine');
    expect(emitted).toContain('running the build again');
    for (const vendor of ['Sonnet', 'Opus', 'GLM', 'Kimi', 'Claude', 'glm-', 'kimi-', 'Gemini', 'Grok']) {
      expect(emitted, vendor).not.toContain(vendor);
    }
  });
});
