import { describe, it, expect, afterEach } from 'vitest';
import {
  NORMAL_MULTIPLIER,
  SONNET_MULTIPLIER,
  OPUS_MULTIPLIER,
  POWER_MULTIPLIER,
  opusRate,
  sonnetRate,
  opusEquivalentUsd,
  sonnetEquivalentUsd,
  billedForTier,
  billedAmountUsd,
  billedAmountInr,
  powerToTier,
  explainBuildCost,
} from './pricing';

const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

describe('explainBuildCost — the honest cost breakdown', () => {
  it('breaks down a cheap (weak/off) build and its billedUsd equals billedAmountUsd', () => {
    const b = explainBuildCost(usage, 'off', 83);
    expect(b.tier).toBe('cheap');
    expect(b.tierLabel).toBe('Cheap');
    expect(b.baseModel).toBe('Sonnet-equivalent');
    expect(b.multiplier).toBe(NORMAL_MULTIPLIER);
    expect(b.inputTokens).toBe(1_000_000);
    expect(b.billedUsd).toBeCloseTo(billedAmountUsd(usage, 'off'), 9);
    expect(b.billedInr).toBeCloseTo(b.billedUsd * 83, 6);
  });

  it('Strong (mini) bills at the Sonnet tier (×3), Powerful/Full-Team at Opus (×2)', () => {
    expect(explainBuildCost(usage, 'mini', 83).tier).toBe('sonnet');
    expect(explainBuildCost(usage, 'mini', 83).multiplier).toBe(SONNET_MULTIPLIER);
    const opus = explainBuildCost(usage, 'max', 83);
    expect(opus.tier).toBe('opus');
    expect(opus.baseModel).toBe('real Opus');
    expect(opus.multiplier).toBe(OPUS_MULTIPLIER);
    expect(opus.billedUsd).toBeCloseTo(billedAmountUsd(usage, 'max'), 9);
  });

  it('powerToTier mirrors the billing tiers exactly', () => {
    expect(powerToTier(false)).toBe('cheap');
    expect(powerToTier('weak')).toBe('cheap');
    expect(powerToTier('mini')).toBe('sonnet');
    expect(powerToTier('medium')).toBe('opus');
    expect(powerToTier('max')).toBe('opus');
  });

  it('clamps negative tokens and a negative rate to zero', () => {
    const b = explainBuildCost({ inputTokens: -5, outputTokens: -9 }, 'off', -10);
    expect(b.inputTokens).toBe(0);
    expect(b.outputTokens).toBe(0);
    expect(b.billedInr).toBe(0);
    expect(b.usdInrRate).toBe(0);
  });
});

describe('pricing — rates & equivalents', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('default Opus and Sonnet rates', () => {
    expect(opusRate()).toEqual({ inputPerMTok: 15, outputPerMTok: 75 });
    expect(sonnetRate()).toEqual({ inputPerMTok: 3, outputPerMTok: 15 });
  });

  it('opusEquivalentUsd / sonnetEquivalentUsd price tokens at the right rate', () => {
    // 1M in + 1M out → Opus 15+75 = 90; Sonnet 3+15 = 18.
    expect(opusEquivalentUsd(usage)).toBeCloseTo(90, 6);
    expect(sonnetEquivalentUsd(usage)).toBeCloseTo(18, 6);
  });

  it('clamps negative token counts to zero', () => {
    expect(sonnetEquivalentUsd({ inputTokens: -5, outputTokens: -5 })).toBe(0);
  });

  it('honours env rate overrides', () => {
    process.env.SONNET_INPUT_PER_MTOK = '4';
    process.env.SONNET_OUTPUT_PER_MTOK = '20';
    expect(sonnetRate()).toEqual({ inputPerMTok: 4, outputPerMTok: 20 });
  });
});

describe('pricing — billed amount (the admin model, 2026-07-05)', () => {
  it('the three tier multipliers', () => {
    expect(NORMAL_MULTIPLIER).toBe(1.2); // cheap
    expect(SONNET_MULTIPLIER).toBe(3);
    expect(OPUS_MULTIPLIER).toBe(2);
    expect(POWER_MULTIPLIER).toBe(2); // back-compat alias → Opus tier
  });

  it('billedForTier: cheap → Sonnet×1.2, sonnet → Sonnet×3, opus → real Opus×2', () => {
    // Sonnet-equivalent = 18, real Opus = 90.
    expect(billedForTier(usage, 'cheap')).toBeCloseTo(18 * 1.2, 6);  // 21.6
    expect(billedForTier(usage, 'sonnet')).toBeCloseTo(18 * 3, 6);   // 54
    expect(billedForTier(usage, 'opus')).toBeCloseTo(90 * 2, 6);     // 180
  });

  it('NORMAL mode (power off) bills the CHEAP tier: Sonnet-equivalent × 1.2', () => {
    expect(billedAmountUsd(usage, false)).toBeCloseTo(18 * 1.2, 6);
    expect(billedAmountUsd(usage)).toBeCloseTo(21.6, 6); // defaults to normal
  });

  it('billing follows the pinned model (admin 2026-07-13): Opus tiers × 2, Strong = Sonnet × 3, off/weak = cheap', () => {
    expect(billedAmountUsd(usage, true)).toBeCloseTo(90 * 2, 6);   // legacy boolean → Opus tier (180)
    expect(billedAmountUsd(usage, 'medium')).toBeCloseTo(180, 6);  // Powerful → real Opus × 2
    expect(billedAmountUsd(usage, 'max')).toBeCloseTo(180, 6);     // Full Team → real Opus × 2
    // Strong ('mini') pins SONNET 100% — it must bill Sonnet-equivalent × 3 (54), NEVER Opus rates
    // for Sonnet work (the old mapping billed 180 here: a ~3.3× overcharge).
    expect(billedAmountUsd(usage, 'mini')).toBeCloseTo(18 * 3, 6); // 54
    expect(billedAmountUsd(usage, 'off')).toBeCloseTo(21.6, 6);    // off → cheap tier
    expect(billedAmountUsd(usage, 'weak')).toBeCloseTo(21.6, 6);   // weak → cheap tier
  });

  it('power costs more in absolute terms (Opus base) than the cheap normal tier', () => {
    expect(billedAmountUsd(usage, true)).toBeGreaterThan(billedAmountUsd(usage, false));
  });

  it('margin is positive in every tier (billed ≥ real provider cost)', () => {
    // Cheap: billed 21.6 ≥ even real Sonnet cost 18 (and >> a real cheap-model cost).
    expect(billedForTier(usage, 'cheap')).toBeGreaterThan(sonnetEquivalentUsd(usage));
    // Sonnet: billed 54 ≥ real Sonnet 18.
    expect(billedForTier(usage, 'sonnet')).toBeGreaterThan(sonnetEquivalentUsd(usage));
    // Opus: billed 180 ≥ real Opus 90.
    expect(billedForTier(usage, 'opus')).toBeGreaterThan(opusEquivalentUsd(usage));
  });

  it('INR billing scales by the USD→INR rate', () => {
    expect(billedAmountInr(usage, 'max', 85)).toBeCloseTo(180 * 85, 4);
    expect(billedAmountInr(usage, 'off', 85)).toBeCloseTo(21.6 * 85, 4);
  });
});

describe('pricing — INR conversion', () => {
  it('billedAmountInr = billedAmountUsd × the USD→INR rate', () => {
    expect(billedAmountInr(usage, false, 85)).toBeCloseTo(21.6 * 85, 4); // normal (cheap × 1.2)
    expect(billedAmountInr(usage, true, 85)).toBeCloseTo(180 * 85, 4);   // power (Opus × 2)
  });

  it('clamps a negative rate to zero', () => {
    expect(billedAmountInr(usage, false, -10)).toBe(0);
  });

  it('a realistic small build is cheap in normal mode (calculator-scale)', () => {
    // ~60k in + 15k out → Sonnet-equiv ≈ 0.405 → × 1.2 × 85 ≈ ₹41.
    const inr = billedAmountInr({ inputTokens: 60_000, outputTokens: 15_000 }, false, 85);
    expect(inr).toBeGreaterThan(20);
    expect(inr).toBeLessThan(80);
  });
});
