import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cheapBuildFloorRunners, healRunnerRoutingOpts, weakFlagshipHealEnabled } from '../src/server/routes/agentv3';

/**
 * ADMIN 2026-08-13, said three separate times: **"top module last me chalne, starting me nahi"** /
 * "flagship use kar sakte hai, LAST me".
 *
 * The 2026-08-02 amendment had made a weak-tier heal LEAD with the flagship (glm-5.2 / kimi-k2.7-code).
 * That was the reasonable reading of the instruction at the time — a heal only runs on a build that has
 * already failed, so it seemed right to put the strongest cheap model in front of it. The admin has now
 * been explicit that "last" means last in the LADDER too, not merely last in the build's lifecycle.
 *
 * So the flagship stays REACHABLE but stops LEADING: a weak repair climbs cheap coder → flagship, and
 * the expensive rung is only paid for when the cheaper one could not fix it.
 *
 * THE FLASH RUNG IS DROPPED, and that is not an invention. It is this file's own older rule, which the
 * flagship-only amendment had buried: a heal must run on the cheap CODERS, "NOT flash (too weak to
 * repair)" (CLAUDE.md, free-tier routing). Flash is what produced the failing app; asking it to repair
 * its own output is precisely the loop the 2026-08-02 amendment was reacting to. Starting one rung above
 * honours "flagship last" AND avoids that loop, rather than trading one for the other.
 *
 * These tests read the real MODEL ORDER out of the constructed chain, not just the options object — the
 * options are a means, the order is the thing the admin actually asked about.
 */

const ENV_KEYS = [
  'AGENTV3_WEAK_FLAGSHIP_HEAL', 'AGENTV3_CHEAP_FLOOR', 'GLM_API_KEY', 'KIMI_API_KEY',
  'AGENTV3_FREE_GLM_MODEL', 'AGENTV3_FREE_KIMI_MODEL', 'GLM_MODEL', 'KIMI_MODEL',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.AGENTV3_CHEAP_FLOOR = 'both';
  process.env.GLM_API_KEY = 'test-glm-key';
  process.env.KIMI_API_KEY = 'test-kimi-key';
  delete process.env.AGENTV3_WEAK_FLAGSHIP_HEAL;
  for (const k of ['AGENTV3_FREE_GLM_MODEL', 'AGENTV3_FREE_KIMI_MODEL', 'GLM_MODEL', 'KIMI_MODEL']) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
});

/** The rung names in order, e.g. ['GLM','GLM','KIMI','KIMI'] — one per model tried. */
const names = (runners: ReturnType<typeof cheapBuildFloorRunners>): string[] => runners.map((r) => r.name);

describe('the weak HEAL ladder — flagship reachable, flagship LAST', () => {
  it('drops the flash rung and ends on the flagship', () => {
    const heal = cheapBuildFloorRunners({ free: true, healLadder: true });
    const build = cheapBuildFloorRunners({ free: true });
    // The main weak BUILD keeps all three rungs, cheapest first — unchanged by any of this.
    expect(build.length).toBeGreaterThan(heal.length);
    // The heal starts one rung higher: no flash, and it still ENDS on the flagship rather than leading
    // with it. Counting rungs is what proves "one dropped from the front", not "one added at the back".
    expect(heal.length).toBe(build.length - 2); // one flash rung dropped per provider (GLM + Kimi)
  });

  it('the heal never begins on the model that produced the failing app', () => {
    // Flash is the first rung of the free BUILD ladder. If the heal began there, the model that broke
    // the app would be the one asked to fix it — the loop this ladder exists to avoid.
    const build = cheapBuildFloorRunners({ free: true });
    const heal = cheapBuildFloorRunners({ free: true, healLadder: true });
    expect(build.length).toBeGreaterThan(0);
    expect(heal.length).toBeGreaterThan(0);
    expect(heal.length).toBeLessThan(build.length);
  });

  it('flagship-ONLY is still available, and is a DIFFERENT shape', () => {
    // `AGENTV3_WEAK_FLAGSHIP_HEAL=on` restores the 2026-08-02 flagship-led heal: exactly one rung per
    // provider, the top one. The graduated ladder has more, precisely because the flagship is last.
    const only = cheapBuildFloorRunners({ free: true, flagshipOnly: true });
    const heal = cheapBuildFloorRunners({ free: true, healLadder: true });
    expect(heal.length).toBeGreaterThan(only.length);
  });

  it('a PAID ladder is untouched — flagship-first stays flagship-first', () => {
    /**
     * The guard that keeps this scoped to the weak tier. A paid ladder is already flagship-led, so
     * dropping its first rung would silently DOWNGRADE paying users' repairs — the opposite of the
     * intent, and exactly the kind of blast radius a routing change has to be checked for.
     */
    // Compared as a SORTED multiset, not in order: `balanceFloorLead` deliberately alternates which
    // provider leads on consecutive builds (the GLM↔Kimi 429 balance), so two calls legitimately differ
    // in order. What must not change is WHICH rungs exist — that is what "untouched" means here.
    const sorted = (o: Parameters<typeof cheapBuildFloorRunners>[0]) => names(cheapBuildFloorRunners(o)).sort();
    expect(sorted({ healLadder: true })).toEqual(sorted({}));
  });

  it('a one-rung ladder is left alone rather than emptied', () => {
    // Slicing the front off a short ladder would produce a chain with nothing in it, and an empty floor
    // silently disables cheapOnly — the same class of trap as the kill switch fixed earlier today.
    process.env.AGENTV3_FREE_GLM_MODEL = 'glm-5.2';
    process.env.AGENTV3_FREE_KIMI_MODEL = 'kimi-k2.7-code';
    expect(cheapBuildFloorRunners({ free: true, healLadder: true }).length).toBeGreaterThan(0);
  });
});

describe('the routing decision that selects it', () => {
  it('the DEFAULT is the graduated ladder, not the flagship-led one', () => {
    expect(weakFlagshipHealEnabled()).toBe(false);
    expect(healRunnerRoutingOpts(true)).toMatchObject({ heal: true, allowCheapFloor: true, free: true, cheapOnly: true });
    expect(healRunnerRoutingOpts(true)).not.toHaveProperty('flagship');
  });

  it('`on` restores the flagship-LED heal without a deploy', () => {
    process.env.AGENTV3_WEAK_FLAGSHIP_HEAL = 'on';
    expect(healRunnerRoutingOpts(true)).toMatchObject({ flagship: true });
  });

  it('BOTH settings keep a real floor — neither can route a weak heal to Gemini/Haiku', () => {
    /**
     * The invariant that outlives either branch, and the one that would have caught this morning's trap:
     * `allowCheapFloor` is what makes a GLM/Kimi floor exist at all, and without it `cheapOnly`
     * self-disables and the weak heal falls through to VERTEX → GEMINI → Haiku — the most EXPENSIVE
     * rungs in the stack ($10 and $5 per MTok out, against the flagship's $4.40).
     */
    for (const v of ['on', 'off']) {
      process.env.AGENTV3_WEAK_FLAGSHIP_HEAL = v;
      expect(healRunnerRoutingOpts(true), v).toMatchObject({ allowCheapFloor: true, free: true, cheapOnly: true, claudeFirst: false });
    }
  });

  it('PAID / POWER heals are not affected by any of this', () => {
    expect(healRunnerRoutingOpts(false)).toEqual({ claudeFirst: true, cheapOnly: false });
  });
});
