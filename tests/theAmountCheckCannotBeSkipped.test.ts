// Q-890/Q-1226: test the production parser, not a duplicate Number-coercion algorithm.
import { describe, it, expect } from 'vitest';
import { reconcileGatewayPaidAmount } from '../src/server/lib/paymentReconciliation';

describe('the paid-vs-recorded check cannot be skipped by unreadable amounts', () => {
  it('refuses unreadable or non-positive provider amounts', () => {
    for (const bad of [undefined, null, 'abc', NaN, Infinity, {}, [], '', ' ', true, 0, -1]) {
      expect(() => reconcileGatewayPaidAmount(bad, bad)).toThrow('could not be verified');
    }
  });
  it('uses the real gateway amount when our own record cannot be read', () => {
    for (const bad of [undefined, null, 'legacy', NaN, {}, [], '', true]) {
      expect(reconcileGatewayPaidAmount(499, bad)).toEqual({ amountPaid: 499, unreadableRecorded: true });
    }
  });
  it('normalizes numeric strings and keeps the one-paisa mismatch tolerance', () => {
    expect(reconcileGatewayPaidAmount('499', '499')).toEqual({ amountPaid: 499, unreadableRecorded: false });
    expect(reconcileGatewayPaidAmount(499.005, 499).amountPaid).toBe(499.005);
    expect(reconcileGatewayPaidAmount(100.01, 100).amountPaid).toBe(100.01);
    expect(() => reconcileGatewayPaidAmount(100.01001, 100)).toThrow('amount mismatch');
    expect(() => reconcileGatewayPaidAmount(90071992547400, 90071992547399.97)).toThrow('amount mismatch');
    expect(() => reconcileGatewayPaidAmount(500, 499)).toThrow('amount mismatch');
    expect(() => reconcileGatewayPaidAmount(499.02, 499)).toThrow('amount mismatch');
  });
  it('never names the provider to a payer in a refusal', () => {
    for (const args of [[undefined, 100], [101, 100]]) {
      try { reconcileGatewayPaidAmount(args[0], args[1]); throw new Error('expected refusal'); }
      catch (e) { expect(String(e)).not.toMatch(/cashfree|razorpay|stripe/i); }
    }
  });
});
