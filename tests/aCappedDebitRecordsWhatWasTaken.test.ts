import { describe, it, expect } from 'vitest';
import { computeDebitedWallet } from '../src/server/lib/walletDebit';
import { chargeRecordFields } from '../src/server/lib/chargeRecord';

// r6–r10 autopsy: a debit capped by the overdraft floor was reported at its PRE-cap price.
const NOW = '2026-10-18T00:00:00.000Z';

describe('a capped debit records what was actually taken', () => {
  it('a debit capped by the floor reports the debited ₹ and the absorbed ₹', () => {
    // ₹10 balance, ₹50 floor → at most ₹60 can be taken from a ₹100 bill.
    const r = computeDebitedWallet({ tokenBalance: 10 * 100 }, { billedInr: 100, buildRef: 'b1', description: 'x', floorInr: 50 } as any, NOW);
    expect(r.applied).toBe(true);
    expect(r.debitedInr).toBeLessThan(100);
    expect((r.debitedInr ?? 0) + (r.absorbedInr ?? 0)).toBeCloseTo(100, 1);
    const f = chargeRecordFields(r);
    expect(f.partialDebit).toBe(true);
    expect(f.walletDebitedInr).toBe(r.debitedInr);
    expect(f.absorbedInr).toBeGreaterThan(0);
  });

  it('an uncapped debit is NOT flagged partial, and the price is unchanged', () => {
    const r = computeDebitedWallet({ tokenBalance: 1000 * 100 }, { billedInr: 12.34, buildRef: 'b2', description: 'x', floorInr: 50 } as any, NOW);
    expect(r.debitedInr).toBeCloseTo(12.34, 2);
    expect(r.absorbedInr).toBe(0);
    const f = chargeRecordFields(r);
    expect(f.partialDebit).toBeUndefined();
    expect(f.absorbedInr).toBeUndefined();
  });

  it('no debit → no fields (never invents a charge)', () => {
    expect(chargeRecordFields(null)).toEqual({});
    expect(chargeRecordFields({ tokensDebited: 0 } as any)).toEqual({});
  });
});
