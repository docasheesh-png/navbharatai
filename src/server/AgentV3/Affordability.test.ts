import { describe, it, expect } from 'vitest';
import { decideAffordability } from './Affordability';

const OD = 20; // overdraft tolerance (floor = -20)

describe('decideAffordability — the admin\'s 4 rules', () => {
  it('FREE-LIST always proceeds, exactly as today (no gate, even at a huge negative balance)', () => {
    expect(decideAffordability({ isFreeUser: true, balance: -1000, estimate: 500, overdraft: OD }))
      .toEqual({ action: 'proceed', reason: 'free-list' });
  });

  it('balance ≥ estimate → proceed as today (no routing change)', () => {
    expect(decideAffordability({ isFreeUser: false, balance: 100, estimate: 60, overdraft: OD }).action).toBe('proceed');
    // exactly-equal counts as covered
    expect(decideAffordability({ isFreeUser: false, balance: 60, estimate: 60, overdraft: OD }).reason).toBe('covers-estimate');
  });

  it('floor < balance < estimate → ECONOMY engine + honest notice (work never stops)', () => {
    const d = decideAffordability({ isFreeUser: false, balance: 5, estimate: 60, overdraft: OD });
    expect(d.action).toBe('economy');
    expect(d.notice).toMatch(/economy engine/i);
    // even a tiny/near-zero balance still gets an economy build (admin: "kam ₹ ho to cheap se banao")
    expect(decideAffordability({ isFreeUser: false, balance: 0.01, estimate: 500, overdraft: OD }).action).toBe('economy');
    // a slightly-negative balance still ABOVE the floor → still economy, not blocked
    expect(decideAffordability({ isFreeUser: false, balance: -19, estimate: 60, overdraft: OD }).action).toBe('economy');
  });

  it('balance ≤ floor → BLOCK (the ONE refusal) with an add-credits notice', () => {
    expect(decideAffordability({ isFreeUser: false, balance: -20, estimate: 60, overdraft: OD }).action).toBe('block');
    expect(decideAffordability({ isFreeUser: false, balance: -25, estimate: 1, overdraft: OD }).action).toBe('block');
    expect(decideAffordability({ isFreeUser: false, balance: -20, estimate: 60, overdraft: OD }).notice).toMatch(/add credits/i);
  });

  it('the floor is exactly -overdraft (boundary): -20 blocks, -19.99 is economy', () => {
    expect(decideAffordability({ isFreeUser: false, balance: -20, estimate: 60, overdraft: OD }).action).toBe('block');
    expect(decideAffordability({ isFreeUser: false, balance: -19.99, estimate: 60, overdraft: OD }).action).toBe('economy');
  });

  it('a non-positive/junk overdraft means NO tolerance (floor 0): balance 0 blocks', () => {
    expect(decideAffordability({ isFreeUser: false, balance: 0, estimate: 60, overdraft: 0 }).action).toBe('block');
    expect(decideAffordability({ isFreeUser: false, balance: 0, estimate: 60, overdraft: NaN }).action).toBe('block');
    // just above the 0 floor with 0 tolerance → economy
    expect(decideAffordability({ isFreeUser: false, balance: 1, estimate: 60, overdraft: 0 }).action).toBe('economy');
  });
});
