import { describe, it, expect } from 'vitest';
import {
  ordersToReconcile, reconcileMessage, reconcileMinAgeMs, reconcileMaxAgeMs, reconcileMaxOrders,
  type PendingOrderRecord,
} from '../src/server/lib/pendingOrders';

// A Cashfree payment reached the wallet by two routes, and both can miss. The webhook is rejected
// outright unless CASHFREE_WEBHOOK_SECRET is set — the signature cannot be verified without it — so
// with the secret unset it delivers nothing. The other route needs the user to return to the app
// carrying `?payment=success`. Someone who pays by UPI and closes the app satisfied neither: they had
// genuinely paid, their order sat at PENDING forever, and nothing ever revisited it.
//
// This is the third path. These tests are about which orders are worth asking about, and about not
// telling a user anything unless money really arrived.

const MIN = 60_000;
const T0 = Date.parse('2026-08-01T12:00:00.000Z');
const order = (id: string, ageMinutes: number, status = 'PENDING'): PendingOrderRecord => ({
  transactionId: id,
  paymentStatus: status,
  createdAt: new Date(T0 - ageMinutes * MIN).toISOString(),
});

describe('which orders are worth asking Cashfree about', () => {
  it('picks up the payment that was made and never credited', () => {
    expect(ordersToReconcile([order('ord_a', 30)], T0, {})).toEqual(['ord_a']);
  });

  it('leaves a brand-new order alone — the user is still on their UPI app', () => {
    // Asking about an order created seconds ago just spends a call to be told PENDING; the redirect
    // path already covers the fast case.
    expect(reconcileMinAgeMs({})).toBe(2 * MIN);
    expect(ordersToReconcile([order('ord_a', 0), order('ord_b', 1)], T0, {})).toEqual([]);
    expect(ordersToReconcile([order('ord_c', 3)], T0, {})).toEqual(['ord_c']);
  });

  it('stops looking once an order is too old to be payable', () => {
    expect(reconcileMaxAgeMs({})).toBe(7 * 24 * 60 * MIN);
    expect(ordersToReconcile([order('ord_old', 8 * 24 * 60)], T0, {})).toEqual([]);
    expect(ordersToReconcile([order('ord_week', 6 * 24 * 60)], T0, {})).toEqual(['ord_week']);
  });

  it('ignores orders that are already settled either way', () => {
    const records = [order('paid', 30, 'SUCCESS'), order('failed', 30, 'FAILED'), order('open', 30)];
    expect(ordersToReconcile(records, T0, {})).toEqual(['open']);
  });

  it('is case-insensitive about the stored status rather than missing a payment over it', () => {
    expect(ordersToReconcile([order('ord_a', 30, 'pending')], T0, {})).toEqual(['ord_a']);
  });

  it('checks the newest first and caps how many it will ask about', () => {
    // Each order is a network call, so one sweep stays bounded — and the most recent order is the one
    // most likely to be a real payment the user is waiting on.
    expect(reconcileMaxOrders({})).toBe(5);
    const many = Array.from({ length: 12 }, (_, i) => order(`ord_${i}`, 10 + i));
    const picked = ordersToReconcile(many, T0, {});
    expect(picked).toHaveLength(5);
    expect(picked[0]).toBe('ord_0'); // youngest
    expect(picked[4]).toBe('ord_4');
  });

  it('skips a record whose age cannot be read instead of guessing at it', () => {
    // It can be placed neither inside nor outside the window. Skipping costs one retry on the user's
    // next visit; guessing wrong costs a pointless call on every visit forever.
    const broken = [
      { transactionId: 'a', paymentStatus: 'PENDING' },
      { transactionId: 'b', paymentStatus: 'PENDING', createdAt: 'yesterday' },
      { transactionId: 'c', paymentStatus: 'PENDING', createdAt: '' },
    ];
    expect(ordersToReconcile(broken, T0, {})).toEqual([]);
  });

  it('skips a record with no order id, and survives an empty or absent list', () => {
    expect(ordersToReconcile([{ paymentStatus: 'PENDING', createdAt: new Date(T0 - 30 * MIN).toISOString() }], T0, {})).toEqual([]);
    expect(ordersToReconcile([], T0, {})).toEqual([]);
    expect(ordersToReconcile(null as unknown as PendingOrderRecord[], T0, {})).toEqual([]);
  });

  it('every window is retunable from Cloud Run, and rubbish keeps the safe default', () => {
    expect(reconcileMinAgeMs({ PAYMENT_RECONCILE_MIN_AGE_MINUTES: '10' })).toBe(10 * MIN);
    expect(reconcileMaxOrders({ PAYMENT_RECONCILE_MAX_ORDERS: '99' })).toBe(20); // hard ceiling
    expect(reconcileMinAgeMs({ PAYMENT_RECONCILE_MIN_AGE_MINUTES: 'soon' })).toBe(2 * MIN);
    expect(reconcileMaxOrders({ PAYMENT_RECONCILE_MAX_ORDERS: '-1' })).toBe(5);
  });
});

describe('what the user is told', () => {
  it('says nothing at all unless money actually arrived', () => {
    // Opening the app must never produce a payment notice, and "no payments found" would read as a
    // failure to someone who never paid in the first place.
    expect(reconcileMessage(0, 0)).toBeNull();
    expect(reconcileMessage(0, 3)).toBeNull();   // three orders checked, none paid
    expect(reconcileMessage(250, 0)).toBeNull(); // nothing credited
    expect(reconcileMessage(NaN, 1)).toBeNull();
  });

  it('reports a real recovery plainly, in rupees', () => {
    expect(reconcileMessage(250, 1)).toContain('₹250');
    expect(reconcileMessage(250, 1)).toContain('had not reached your wallet');
  });

  it('counts correctly when more than one payment is recovered', () => {
    const msg = reconcileMessage(450, 2) || '';
    expect(msg).toContain('2 payments');
    expect(msg).toContain('₹450');
  });

  it('never names the payment provider (white-label law)', () => {
    const msg = (reconcileMessage(250, 1) || '').toLowerCase();
    for (const vendor of ['cashfree', 'razorpay', 'upi', 'stripe', 'webhook']) {
      expect(msg).not.toContain(vendor);
    }
  });
});
