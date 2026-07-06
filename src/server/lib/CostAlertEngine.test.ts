import { describe, it, expect } from 'vitest';
import { buildCostAlertReport, DEFAULT_WARN_PCT } from './CostAlertEngine';

describe('buildCostAlertReport', () => {
  it('reports budgetSet:false and no alerts when no budget is set', () => {
    const r = buildCostAlertReport(500, 0);
    expect(r.budgetSet).toBe(false);
    expect(r.alerts).toEqual([]);
    expect(r.usedPct).toBe(0);
    expect(r.spendInr).toBe(500);
  });

  it('raises no alert well under the warn threshold', () => {
    const r = buildCostAlertReport(400, 1000); // 40%
    expect(r.budgetSet).toBe(true);
    expect(r.alerts).toEqual([]);
    expect(r.remainingInr).toBe(600);
    expect(r.usedPct).toBe(0.4);
  });

  it('raises an approaching warning at the default 80% threshold', () => {
    const r = buildCostAlertReport(800, 1000); // exactly 80%
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].id).toBe('budget-approaching');
    expect(r.alerts[0].severity).toBe('warning');
    expect(r.remainingInr).toBe(200);
  });

  it('does not warn just below the threshold', () => {
    const r = buildCostAlertReport(799, 1000); // 79.9%
    expect(r.alerts).toEqual([]);
  });

  it('raises a critical alert when the budget is exceeded', () => {
    const r = buildCostAlertReport(1200, 1000); // 120%
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].id).toBe('budget-exceeded');
    expect(r.alerts[0].severity).toBe('critical');
    expect(r.remainingInr).toBe(0); // never negative
    expect(r.usedPct).toBe(1.2);
  });

  it('treats exactly 100% as exceeded, not approaching', () => {
    const r = buildCostAlertReport(1000, 1000);
    expect(r.alerts[0].id).toBe('budget-exceeded');
  });

  it('respects a custom warn threshold', () => {
    expect(buildCostAlertReport(500, 1000, 0.5).alerts[0].id).toBe('budget-approaching');
    expect(buildCostAlertReport(490, 1000, 0.5).alerts).toEqual([]);
  });

  it('falls back to the default warn pct for an out-of-range value', () => {
    // warnAtPct 2 is invalid → default 0.8 used → 850/1000 = 85% warns
    const r = buildCostAlertReport(850, 1000, 2);
    expect(r.alerts[0].id).toBe('budget-approaching');
    expect(DEFAULT_WARN_PCT).toBe(0.8);
  });

  it('treats negative/NaN spend as zero', () => {
    expect(buildCostAlertReport(-50, 1000).spendInr).toBe(0);
    expect(buildCostAlertReport(NaN, 1000).spendInr).toBe(0);
  });
});
