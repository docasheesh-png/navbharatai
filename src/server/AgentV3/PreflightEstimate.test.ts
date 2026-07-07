import { describe, it, expect } from 'vitest';
import { estimateBuildTokens, estimateBuildCost } from './PreflightEstimate';
import { billedAmountUsd, billedAmountInr } from './pricing';

describe('estimateBuildTokens — pure token projection', () => {
  it('a zero-size build still carries the fixed base overhead (never ~0)', () => {
    const u = estimateBuildTokens(0, 0);
    expect(u.inputTokens).toBe(20_000);
    expect(u.outputTokens).toBe(8_000);
  });

  it('scales monotonically with modules and features', () => {
    const small = estimateBuildTokens(1, 1);
    const big = estimateBuildTokens(10, 20);
    expect(big.inputTokens).toBeGreaterThan(small.inputTokens);
    expect(big.outputTokens).toBeGreaterThan(small.outputTokens);
    // exact marginal math: base + 3*module + 2*feature
    expect(estimateBuildTokens(3, 2).inputTokens).toBe(20_000 + 3 * 8_000 + 2 * 1_000);
    expect(estimateBuildTokens(3, 2).outputTokens).toBe(8_000 + 3 * 4_000 + 2 * 1_500);
  });

  it('clamps negative / NaN counts to zero (never negative tokens)', () => {
    expect(estimateBuildTokens(-5, -9)).toEqual({ inputTokens: 20_000, outputTokens: 8_000 });
    expect(estimateBuildTokens(NaN, NaN)).toEqual({ inputTokens: 20_000, outputTokens: 8_000 });
  });
});

describe('estimateBuildCost — priced via the SAME billing functions the real charge uses', () => {
  it('USD/INR equal billedAmount* applied to the projected usage (no private formula)', () => {
    const rate = 84;
    const est = estimateBuildCost('build me a todo app with login', false, rate);
    expect(est.usd).toBeCloseTo(billedAmountUsd(est.usage, false), 10);
    expect(est.inr).toBeCloseTo(billedAmountInr(est.usage, false, rate), 10);
    // INR is exactly USD × rate
    expect(est.inr).toBeCloseTo(est.usd * rate, 10);
  });

  it('opus/power builds cost more than the same prompt on the cheap tier', () => {
    const rate = 84;
    const cheap = estimateBuildCost('a big dashboard with 10 pages and analytics', false, rate);
    const opus = estimateBuildCost('a big dashboard with 10 pages and analytics', 'max', rate);
    expect(opus.usd).toBeGreaterThan(cheap.usd);
    // same projected usage, only the tier multiplier differs
    expect(opus.usage).toEqual(cheap.usage);
  });

  it('is deterministic — same inputs give the same estimate', () => {
    const a = estimateBuildCost('a chat app', false, 84);
    const b = estimateBuildCost('a chat app', false, 84);
    expect(a).toEqual(b);
  });

  it('a bigger prompt estimates a higher cost than a trivial one', () => {
    const rate = 84;
    const trivial = estimateBuildCost('a button', false, rate);
    const large = estimateBuildCost(
      'build a full e-commerce platform with products, cart, checkout, payments, orders, admin dashboard, and user accounts',
      false,
      rate,
    );
    expect(large.inr).toBeGreaterThan(trivial.inr);
  });

  it('handles an empty prompt without throwing (base-cost estimate)', () => {
    const est = estimateBuildCost('', false, 84);
    expect(est.usd).toBeGreaterThan(0);
    expect(est.inr).toBeGreaterThan(0);
  });
});
