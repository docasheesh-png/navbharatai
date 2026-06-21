import { describe, it, expect } from 'vitest';
import { RepairBudgetManager } from '../src/server/AppMakerLab/repair/RepairBudgetManager';

describe('RepairBudgetManager.checkBudget', () => {
  const mgr = new RepairBudgetManager();
  // Defaults: maxAttempts=3, maxTokens=200_000, maxDurationMs=300_000

  it('returns true when all values are well within budget', () => {
    expect(mgr.checkBudget(1, 1000, 1000)).toBe(true);
  });

  it('returns true at the exact limit (boundary)', () => {
    expect(mgr.checkBudget(3, 200_000, 300_000)).toBe(true);
  });

  it('returns false when attempts exceed maxAttempts (3)', () => {
    expect(mgr.checkBudget(4, 100, 100)).toBe(false);
  });

  it('returns false when tokens exceed maxTokens (200 000)', () => {
    expect(mgr.checkBudget(1, 200_001, 100)).toBe(false);
  });

  it('returns false when duration exceeds maxDurationMs (300 000)', () => {
    expect(mgr.checkBudget(1, 100, 300_001)).toBe(false);
  });

  it('returns false when multiple limits are exceeded', () => {
    expect(mgr.checkBudget(10, 999_999, 999_999)).toBe(false);
  });
});
