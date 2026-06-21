import { describe, it, expect } from 'vitest';
import { RepairBudgetManager } from '../src/server/AppMakerLab/repair/RepairBudgetManager';

describe('RepairBudgetManager', () => {
  it('returns true when all limits satisfied', () => {
    const mgr = new RepairBudgetManager();
    expect(mgr.checkBudget(2, 100_000, 100_000)).toBe(true);
  });

  it('returns false when attempts exceed max (3)', () => {
    const mgr = new RepairBudgetManager();
    expect(mgr.checkBudget(4, 100_000, 100_000)).toBe(false);
  });

  it('returns false when tokens exceed max (200000)', () => {
    const mgr = new RepairBudgetManager();
    expect(mgr.checkBudget(1, 250_000, 100_000)).toBe(false);
  });

  it('returns false when duration exceeds max (300000ms)', () => {
    const mgr = new RepairBudgetManager();
    expect(mgr.checkBudget(1, 100_000, 400_000)).toBe(false);
  });

  it('returns true at exact boundary values', () => {
    const mgr = new RepairBudgetManager();
    expect(mgr.checkBudget(3, 200_000, 300_000)).toBe(true);
  });
});
