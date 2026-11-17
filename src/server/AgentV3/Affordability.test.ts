import { describe, it, expect } from 'vitest';
import { decideAffordability } from './Affordability';

const OD = 20; // legacy overdraft param — now ignored by the start-gate (block floor is a hard 0)

describe('decideAffordability — no free builds at zero balance (admin 2026-07-12)', () => {
  it('FREE-LIST always proceeds, exactly as today (no gate, even at a huge negative balance)', () => {
    expect(decideAffordability({ isFreeUser: true, balance: -1000, estimate: 500, overdraft: OD }))
      .toEqual({ action: 'proceed', reason: 'free-list' });
  });

  it('balance ≥ estimate → proceed as today (no routing change)', () => {
    expect(decideAffordability({ isFreeUser: false, balance: 100, estimate: 60, overdraft: OD }).action).toBe('proceed');
    // exactly-equal counts as covered
    expect(decideAffordability({ isFreeUser: false, balance: 60, estimate: 60, overdraft: OD }).reason).toBe('covers-estimate');
  });

  it('0 < balance < estimate → BLOCK (owner t403u: a short balance does not start a cheap build)', () => {
    const d = decideAffordability({ isFreeUser: false, balance: 5, estimate: 60, overdraft: OD });
    expect(d.action).toBe('block');
    expect(d.reason).toBe('below-estimate');
    expect(decideAffordability({ isFreeUser: false, balance: 0.01, estimate: 500, overdraft: OD }).action).toBe('block');
  });

  it('balance EXACTLY 0 → BLOCK — the reported bug: "0 balance par bhi app build ho rahi hai"', () => {
    const d = decideAffordability({ isFreeUser: false, balance: 0, estimate: 60, overdraft: OD });
    expect(d.action).toBe('block');
    expect(d.reason).toBe('no-balance');
    expect(d.notice).toMatch(/add credits/i);
  });

  it('ANY negative balance → BLOCK (no more free builds inside the old ₹20 overdraft window)', () => {
    // These all PROCEEDED (economy) under the old -overdraft floor; now they are correctly refused.
    expect(decideAffordability({ isFreeUser: false, balance: -0.01, estimate: 60, overdraft: OD }).action).toBe('block');
    expect(decideAffordability({ isFreeUser: false, balance: -19, estimate: 60, overdraft: OD }).action).toBe('block');
    expect(decideAffordability({ isFreeUser: false, balance: -20, estimate: 60, overdraft: OD }).action).toBe('block');
    expect(decideAffordability({ isFreeUser: false, balance: -25, estimate: 1, overdraft: OD }).action).toBe('block');
  });

  it('the block floor is exactly 0, and a positive balance below the estimate also blocks', () => {
    expect(decideAffordability({ isFreeUser: false, balance: 0, estimate: 60, overdraft: OD }).action).toBe('block');
    expect(decideAffordability({ isFreeUser: false, balance: 0.01, estimate: 60, overdraft: OD }).action).toBe('block');
    expect(decideAffordability({ isFreeUser: false, balance: 60, estimate: 60, overdraft: OD }).action).toBe('proceed');
  });

  it('the overdraft param is ignored — behavior is identical whether it is 20, 0, or junk', () => {
    for (const overdraft of [20, 0, NaN, -5]) {
      expect(decideAffordability({ isFreeUser: false, balance: 0, estimate: 60, overdraft }).action).toBe('block');
      expect(decideAffordability({ isFreeUser: false, balance: 1, estimate: 60, overdraft }).action).toBe('block');
    }
  });
});
