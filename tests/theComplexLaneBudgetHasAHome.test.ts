/**
 * THE COMPLEX FAST-LANE BUDGET IS NOT DEAD CODE — IT HAS A HOME, AND THIS SAYS WHERE (2026-09-25).
 *
 * Autopsy 2a7fa4b0 recorded my own #3285 budget (480 s for a complex build's fast lane) as "inert by
 * default": a complex build opens past the flash rung onto a model that always reasons, and the
 * reasoning gate (#3278) then skips the lane. Measured, that is true on every tier with its keys set —
 * and it is also not the whole story. The lane still runs for a complex build when:
 *   • the reasoning gate is switched off (`AGENTV3_FASTLANE_REASONING_GATE=off`) — the exact
 *     conditions of autopsy 3ab93068, which is what the budget was written for; or
 *   • the reasoning rungs have no key, so the opener falls to a rung that answers directly.
 * On those paths 240 s is what cut 3ab93068's shared contract at 56 s. So the budget stays; this file
 * pins which path uses it, so nobody deletes it as dead or mistakes it for the default.
 */
import { describe, it, expect } from 'vitest';
import { fastLaneRungDecision } from '../src/server/AgentV3/fastLaneRung';
import { tierLadder } from '../src/server/AgentV3/tierLadder';
import { fastLaneBudgetMs, FAST_LANE_COMPLEX_BUDGET_MS } from '../src/server/AgentV3/SimpleBuilder';

const TIERS = ['weak', 'off', 'mini'] as const;

describe('a complex build and the fast lane', () => {
  it.each(TIERS)('%s, every key set: the lane is skipped (the complex opener always reasons)', (tier) => {
    expect(fastLaneRungDecision(tierLadder(tier).rungs, { complex: true }).skip).toBe(true);
  });

  it.each(TIERS)('%s, gate switched off: the lane runs — and that is the path the 480 s budget serves', (tier) => {
    expect(fastLaneRungDecision(tierLadder(tier).rungs, { complex: true, enabled: false }).skip).toBe(false);
    expect(fastLaneBudgetMs(true, {})).toBe(FAST_LANE_COMPLEX_BUDGET_MS);
  });

  it.each(TIERS)('%s, reasoning rungs keyless: the opener answers directly, the lane runs', (tier) => {
    const d = fastLaneRungDecision(tierLadder(tier).rungs, { complex: true, isKeyed: (r) => !/^(GLM|KIMI)$/.test(r.provider) });
    expect(d.skip).toBe(false);
  });

  it('an ordinary build keeps the ordinary budget', () => {
    expect(fastLaneBudgetMs(false, {})).toBe(240_000);
  });
});
