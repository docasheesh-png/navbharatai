import { describe, it, expect } from 'vitest';
import { preambleCapMs, canFinishRemainingTiers, earlyBailReason, BUILD_PHASE_RESERVE } from './FastLaneBudget';

// The reported build's real numbers (buildId 858f6d7b): a 240s lane budget, a plan call that took 89s
// against its 90s cap, then a 70s contract call — 159s gone before the first file was written.
const OVERALL = 240_000;
const CONFIGURED_CAP = 90_000;
const REPORTED_PLAN_MS = 89_000;

describe('preambleCapMs', () => {
  it('the OLD behaviour was structurally impossible: two 90s caps inside a 240s budget', () => {
    // Documents the defect this function exists to remove — 180s of preamble in a 240s lane leaves 60s
    // to generate the entire app.
    expect(CONFIGURED_CAP * 2).toBeGreaterThan(OVERALL * (1 - BUILD_PHASE_RESERVE));
  });

  it('gives the plan its full configured cap when nothing has been spent yet', () => {
    expect(preambleCapMs(OVERALL, 0, CONFIGURED_CAP)).toBe(CONFIGURED_CAP);
  });

  it('shrinks the contract cap after a slow plan instead of compounding with it (the reported build)', () => {
    const contractCap = preambleCapMs(OVERALL, REPORTED_PLAN_MS, CONFIGURED_CAP);
    // The preamble's whole share is 40% of 240s = 96s; 89s is already spent, so 7s remain.
    expect(contractCap).toBe(7_000);
    // The decisive property: plan + contract can no longer exceed the preamble's share.
    expect(REPORTED_PLAN_MS + contractCap).toBeLessThanOrEqual(OVERALL * (1 - BUILD_PHASE_RESERVE));
  });

  it('leaves the reserved majority of the budget for actually generating files', () => {
    const planCap = preambleCapMs(OVERALL, 0, CONFIGURED_CAP);
    const contractCap = preambleCapMs(OVERALL, planCap, CONFIGURED_CAP);
    expect(OVERALL - planCap - contractCap).toBeGreaterThanOrEqual(OVERALL * BUILD_PHASE_RESERVE);
  });

  it('returns 0 once the preamble share is spent — skip the phase, never starve file generation', () => {
    expect(preambleCapMs(OVERALL, 96_000, CONFIGURED_CAP)).toBe(0);
    expect(preambleCapMs(OVERALL, 200_000, CONFIGURED_CAP)).toBe(0);
  });

  it('never returns a negative cap on nonsense input', () => {
    expect(preambleCapMs(0, 0, CONFIGURED_CAP)).toBe(0);
    expect(preambleCapMs(OVERALL, -5_000, CONFIGURED_CAP)).toBe(CONFIGURED_CAP);
  });
});

describe('canFinishRemainingTiers', () => {
  it('bails on the reported build, which could not have finished (159s preamble + 3 tiers)', () => {
    // Tier 0 (4 hook/type files) took ~45s — its slowest file. Two tiers remain.
    const doomed = { tiersRemaining: 2, lastTierMs: 45_000, elapsedMs: 204_000, overallMs: OVERALL };
    expect(canFinishRemainingTiers(doomed)).toBe(false);
  });

  it('continues the SAME build once the preamble fix frees up its budget', () => {
    // With preambleCapMs applied the preamble ends at 96s, so tier 0 finishes around 141s.
    const rescued = { tiersRemaining: 2, lastTierMs: 45_000, elapsedMs: 141_000, overallMs: OVERALL };
    expect(canFinishRemainingTiers(rescued)).toBe(true);
  });

  it('never bails when no tiers remain', () => {
    expect(canFinishRemainingTiers({ tiersRemaining: 0, lastTierMs: 200_000, elapsedMs: 230_000, overallMs: OVERALL })).toBe(true);
  });

  it('never bails on an absent measurement — no evidence is not evidence of slowness', () => {
    expect(canFinishRemainingTiers({ tiersRemaining: 2, lastTierMs: 0, elapsedMs: 230_000, overallMs: OVERALL })).toBe(true);
  });

  it('keeps a fast tier going — the decision improves automatically instead of encoding a guess', () => {
    expect(canFinishRemainingTiers({ tiersRemaining: 2, lastTierMs: 5_000, elapsedMs: 100_000, overallMs: OVERALL })).toBe(true);
  });

  it('is an exact budget comparison at the boundary', () => {
    expect(canFinishRemainingTiers({ tiersRemaining: 2, lastTierMs: 20_000, elapsedMs: 200_000, overallMs: OVERALL })).toBe(true);
    expect(canFinishRemainingTiers({ tiersRemaining: 2, lastTierMs: 20_001, elapsedMs: 200_000, overallMs: OVERALL })).toBe(false);
  });
});

describe('earlyBailReason', () => {
  it('states the real projection against the real budget', () => {
    const r = earlyBailReason({ tiersRemaining: 2, lastTierMs: 45_000, elapsedMs: 204_000, overallMs: OVERALL });
    expect(r).toContain('294s');
    expect(r).toContain('240s');
  });

  it('names no vendor or model (White-Label Law)', () => {
    const r = earlyBailReason({ tiersRemaining: 2, lastTierMs: 45_000, elapsedMs: 204_000, overallMs: OVERALL }).toLowerCase();
    for (const vendor of ['kimi', 'glm', 'claude', 'sonnet', 'opus', 'gemini', 'grok', 'moonshot']) {
      expect(r).not.toContain(vendor);
    }
  });
});
