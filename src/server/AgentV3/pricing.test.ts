import { describe, it, expect, afterEach } from 'vitest';
import {
  NORMAL_MULTIPLIER,
  POWER_MULTIPLIER,
  opusRate,
  sonnetRate,
  opusEquivalentUsd,
  sonnetEquivalentUsd,
  billedAmountUsd,
  billedAmountInr,
} from './pricing';

const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

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

describe('pricing — billed amount (the admin model)', () => {
  it('NORMAL mode bills Sonnet-equivalent × 3.5', () => {
    expect(NORMAL_MULTIPLIER).toBe(3.5);
    // Sonnet-equivalent = 18 → × 3.5 = 63.
    expect(billedAmountUsd(usage, false)).toBeCloseTo(18 * 3.5, 6);
    expect(billedAmountUsd(usage)).toBeCloseTo(63, 6); // defaults to normal
  });

  it('POWER mode bills real Opus 4.8 cost × 2.5', () => {
    expect(POWER_MULTIPLIER).toBe(2.5);
    // Opus real = 90 → × 2.5 = 225.
    expect(billedAmountUsd(usage, true)).toBeCloseTo(90 * 2.5, 6);
    expect(billedAmountUsd(usage, true)).toBeCloseTo(225, 6);
  });

  it('power costs more in absolute terms despite a lower multiplier (Opus base)', () => {
    expect(billedAmountUsd(usage, true)).toBeGreaterThan(billedAmountUsd(usage, false));
  });

  it('margin is positive in both modes (billed ≥ real provider cost)', () => {
    // Normal: even when Sonnet itself runs, billed (63) ≥ real Sonnet cost (18).
    expect(billedAmountUsd(usage, false)).toBeGreaterThan(sonnetEquivalentUsd(usage));
    // Power: billed (225) ≥ real Opus cost (90).
    expect(billedAmountUsd(usage, true)).toBeGreaterThan(opusEquivalentUsd(usage));
  });

  it('power-level tiers bill real Opus cost × 5 / 10 / 20 (admin override 2026-06-27)', () => {
    // Opus real = 90 → ×5 = 450, ×10 = 900, ×20 = 1800.
    expect(billedAmountUsd(usage, 'off')).toBeCloseTo(63, 6); // Sonnet × 3.5
    expect(billedAmountUsd(usage, 'mini')).toBeCloseTo(450, 6);
    expect(billedAmountUsd(usage, 'medium')).toBeCloseTo(900, 6);
    expect(billedAmountUsd(usage, 'max')).toBeCloseTo(1800, 6);
  });

  it('power-level INR billing scales by the USD→INR rate', () => {
    expect(billedAmountInr(usage, 'max', 85)).toBeCloseTo(1800 * 85, 4);
    expect(billedAmountInr(usage, 'off', 85)).toBeCloseTo(63 * 85, 4);
  });
});

describe('pricing — INR conversion', () => {
  it('billedAmountInr = billedAmountUsd × the USD→INR rate', () => {
    expect(billedAmountInr(usage, false, 85)).toBeCloseTo(63 * 85, 4); // normal
    expect(billedAmountInr(usage, true, 85)).toBeCloseTo(225 * 85, 4); // power
  });

  it('clamps a negative rate to zero', () => {
    expect(billedAmountInr(usage, false, -10)).toBe(0);
  });

  it('a realistic small build is cheap in normal mode (calculator-scale)', () => {
    // ~60k in + 15k out → Sonnet-equiv ≈ 0.405 → × 3.5 × 85 ≈ ₹120.
    const inr = billedAmountInr({ inputTokens: 60_000, outputTokens: 15_000 }, false, 85);
    expect(inr).toBeGreaterThan(80);
    expect(inr).toBeLessThan(200);
  });
});
