/**
 * Round-8 #3 — UserCostStore.record must reject non-finite costs. A bare `costUsd <= 0` check let a
 * NaN through (`NaN <= 0` is false), and `existing + NaN` would permanently poison the stored monthly
 * total (it flows into the Billing panel). isRecordableCost is the single-entry-point invariant.
 */
import { describe, it, expect } from 'vitest';
import { isRecordableCost } from '../src/server/lib/UserCostStore';

describe('isRecordableCost', () => {
  it('accepts finite positive costs', () => {
    expect(isRecordableCost(0.000001)).toBe(true);
    expect(isRecordableCost(0.42)).toBe(true);
    expect(isRecordableCost(1234.5)).toBe(true);
  });

  it('REJECTS NaN and Infinity (the poisoning inputs a bare `<= 0` check would admit)', () => {
    expect(isRecordableCost(NaN)).toBe(false);
    expect(isRecordableCost(Infinity)).toBe(false);
    expect(isRecordableCost(-Infinity)).toBe(false);
  });

  it('rejects zero and negatives', () => {
    expect(isRecordableCost(0)).toBe(false);
    expect(isRecordableCost(-1)).toBe(false);
    expect(isRecordableCost(-0.0001)).toBe(false);
  });
});
