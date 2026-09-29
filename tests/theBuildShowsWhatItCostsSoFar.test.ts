import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liveCostEnabled, liveCostInr, shouldEmitLiveCost, LIVE_COST_MIN_GAP_MS, type LiveCostFacts } from '../src/server/AgentV3/liveBuildCost';
import { applyBuildDiscount } from '../src/server/lib/buildDiscount';
import { liveCostLabel, formatInr } from '../src/components/agentv3/liveCostLabel';
import { agentV3Reducer } from '../src/components/agentv3/agentV3Reducer';
import { initialAgentV3State } from '../src/components/agentv3/agentV3Types';

/**
 * 2026-09-28, admin: approving "build ke dauraan live ₹ kharcha dikhaya jaye — jaise 'ab tak ₹12'".
 * A build billed on real usage now shows what it has cost while it runs — priced by the SAME function
 * as the final bill, shown only to someone who will be charged, and worded so a running total can
 * never pass for the final amount.
 */

const facts = (over: Partial<LiveCostFacts> = {}): LiveCostFacts => ({
  charged: true, onboardingFreeBuildPossible: false, billedUsd: 0.2, floorUsd: 0.05, discountPct: 0, usdInr: 88, ...over,
});

describe('the figure', () => {
  it('is the bill in rupees, to the paisa', () => {
    expect(liveCostInr(facts())).toBe(17.6);
    expect(liveCostInr(facts({ billedUsd: 0.12345 }))).toBe(10.86);
  });

  it('shows NOTHING to someone who will not pay it', () => {
    expect(liveCostInr(facts({ charged: false }))).toBeNull();
    expect(liveCostInr(facts({ onboardingFreeBuildPossible: true }))).toBeNull();
  });

  it('applies the build discount exactly as the bill does, never below our own cost', () => {
    const f = facts({ billedUsd: 1, floorUsd: 0.9, discountPct: 50 });
    const expected = Math.round(applyBuildDiscount({ billedUsd: 1, floorUsd: 0.9, pct: 50 }).payUsd * 88 * 100) / 100;
    expect(liveCostInr(f)).toBe(expected);
    expect(liveCostInr(f)).toBe(79.2); // floored at our 0.9 cost, not 50% off
  });

  it('refuses a number it cannot trust', () => {
    expect(liveCostInr(facts({ billedUsd: Number.NaN }))).toBeNull();
    expect(liveCostInr(facts({ usdInr: 0 }))).toBeNull();
    expect(liveCostInr(facts({ billedUsd: -1 }))).toBeNull();
  });

  it('the kill switch sends nothing', () => {
    expect(liveCostEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(liveCostEnabled({ AGENTV3_LIVE_COST: ' OFF ' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('when an update is sent', () => {
  it('never opens with ₹0.00, never repeats itself, never floods', () => {
    expect(shouldEmitLiveCost(null, 0, 0)).toBe(false);
    expect(shouldEmitLiveCost(null, null, 0)).toBe(false);
    expect(shouldEmitLiveCost(null, 3.2, 0)).toBe(true);
    expect(shouldEmitLiveCost({ inr: 3.2, at: 0 }, 3.2, LIVE_COST_MIN_GAP_MS * 10)).toBe(false);
    expect(shouldEmitLiveCost({ inr: 3.2, at: 0 }, 4, LIVE_COST_MIN_GAP_MS - 1)).toBe(false);
    expect(shouldEmitLiveCost({ inr: 3.2, at: 0 }, 4, LIVE_COST_MIN_GAP_MS)).toBe(true);
  });

  it('a figure that FALLS is sent like one that rises — hiding a fall would be as wrong as hiding a rise', () => {
    expect(shouldEmitLiveCost({ inr: 9, at: 0 }, 6.5, LIVE_COST_MIN_GAP_MS)).toBe(true);
  });
});

describe('what the user reads', () => {
  it('says "so far", in Indian digit grouping, and explains both directions', () => {
    const l = liveCostLabel(1234.5)!;
    expect(l.text).toBe('₹1,234.50 so far');
    expect(l.explanation).toMatch(/More work adds to it/);
    expect(l.explanation).toMatch(/can only lower it/);
    expect(l.explanation).toMatch(/a build that fails is free/);
    expect(formatInr(12)).toBe('₹12.00');
  });

  it('shows nothing for nothing', () => {
    expect(liveCostLabel(0)).toBeNull();
    expect(liveCostLabel(undefined)).toBeNull();
    expect(liveCostLabel(Number.NaN)).toBeNull();
  });

  it('names no engine, vendor or code', () => {
    expect(JSON.stringify(liveCostLabel(42))).not.toMatch(/glm|kimi|claude|gemini|grok|sonnet|opus|token|markup/i);
  });
});

describe('the client state', () => {
  it('records the server\'s figure verbatim and refuses a broken one', () => {
    let s = agentV3Reducer(initialAgentV3State(), { type: 'cost_so_far', inr: 12.4, ts: 1 });
    expect(s.costSoFarInr).toBe(12.4);
    s = agentV3Reducer(s, { type: 'cost_so_far', inr: Number.NaN, ts: 2 });
    expect(s.costSoFarInr).toBe(12.4);
  });

  it('a new build starts from nothing; a reconnect to the same build keeps its figure', () => {
    let s = agentV3Reducer(initialAgentV3State(), { type: 'build_meta', buildId: 'b1', promptHash: 'h', ts: 1 });
    s = agentV3Reducer(s, { type: 'cost_so_far', inr: 8, ts: 2 });
    s = agentV3Reducer(s, { type: 'build_meta', buildId: 'b1', promptHash: 'h', ts: 3 });
    expect(s.costSoFarInr).toBe(8);
    s = agentV3Reducer(s, { type: 'build_meta', buildId: 'b2', promptHash: 'h2', ts: 4 });
    expect(s.costSoFarInr).toBeUndefined();
  });
});

describe('one price, two readings (source guards — nothing else can see a second formula appear)', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const live = route.slice(route.indexOf('// THE LIVE ₹ FIGURE. Priced by'), route.indexOf("emit({ type: 'cost_so_far', inr, ts: now });") + 260);

  it('the live figure is priced by decideBuildBilledUsd with the settle\'s own arguments', () => {
    expect(live).toContain('decideBuildBilledUsd(providerLedger, buildUsage.total(), powerLevelReqEffective, userId ?? undefined, email, vm.usd, barrenPhases)');
    expect(route).toContain('decideBuildBilledUsd(providerLedger, buildUsage.total(), powerLevelReqEffective, userId ?? undefined, email, livePreviewCharge.usd, barrenPhases)');
    // The discount floor is our own cost, as at settle.
    expect(live).toContain('floorUsd: d.realCostUsd + d.sandboxUsd');
  });

  it('"who is charged" is the settle\'s own predicate, word for word', () => {
    const predicate = '(isAgentV3PaidPublicEnabled() || isAgentV3CreditGateEnabled()) && !isAgentV3FreeUser(userId, email)';
    expect(route).toContain(`const billingActive = ${predicate};`);
    expect(route).toContain(`const liveCostCharged = !!userId && ${predicate};`);
  });

  it('the event carries one number and nothing else', () => {
    expect(route).toContain("emit({ type: 'cost_so_far', inr, ts: now });");
  });

  it('it is computed only after the throttle allows it, and can never fail a build', () => {
    expect(live.indexOf('LIVE_COST_MIN_GAP_MS')).toBeLessThan(live.indexOf('decideBuildBilledUsd('));
    expect(live).toContain('catch { /* a live figure we could not price is simply not shown */ }');
  });
});
