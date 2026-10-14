import { describe, it, expect } from 'vitest';
import { paymentRows } from '../src/lib/walletPaymentRows';

/**
 * A PENDING OR FAILED PAYMENT IS NEVER SHOWN AS TOKENS THAT ARRIVED.
 * The class: a list that presents an unconfirmed order as a successful purchase. Only an explicit
 * `SUCCESS` is "paid"; anything unreadable is "waiting"; free credit we GAVE is not a payment at all.
 */
const tx = (over: Record<string, unknown>) => ({
  orderId: 'ord_1', paymentStatus: 'SUCCESS', paymentProvider: 'CASHFREE', amountPaid: 100, balanceAdded: 98, createdAt: '2026-10-12T10:34:00Z', ...over,
});

describe('paymentRows', () => {
  it('a SUCCESS row is paid and carries the tokens it added (₹ × 100)', () => {
    const [r] = paymentRows([tx({})]);
    expect(r).toMatchObject({ reference: 'ord_1', status: 'paid', amountInr: 100, tokens: 9800 });
  });

  it('PENDING is waiting and shows NO tokens; FAILED/CANCELLED/EXPIRED are failed and show none', () => {
    const rows = paymentRows([
      tx({ orderId: 'p', paymentStatus: 'PENDING' }),
      tx({ orderId: 'f', paymentStatus: 'FAILED' }),
      tx({ orderId: 'c', paymentStatus: 'CANCELLED' }),
      tx({ orderId: 'e', paymentStatus: 'EXPIRED' }),
    ], 10);
    const by = Object.fromEntries(rows.map((r) => [r.reference, r]));
    expect(by.p.status).toBe('waiting');
    for (const k of ['p', 'f', 'c', 'e']) expect(by[k].tokens).toBeNull();
    expect(['f', 'c', 'e'].every((k) => by[k].status === 'failed')).toBe(true);
  });

  it('🔒 an unreadable or missing status is NEVER "paid"', () => {
    for (const status of [undefined, null, '', 'success?', 'OK', 7]) {
      const [r] = paymentRows([tx({ paymentStatus: status })]);
      expect(r.status).toBe('waiting');
      expect(r.tokens).toBeNull();
    }
  });

  it('free credit we gave (welcome, coupon, referral, gift) is not a payment', () => {
    const rows = paymentRows(['WELCOME_BONUS', 'COUPON_REDEEM', 'REFERRAL', 'GIFT_REDEEM'].map((p, i) => tx({ orderId: `g${i}`, paymentProvider: p })), 10);
    expect(rows).toEqual([]);
  });

  it('a zero-amount or reference-less row is dropped, junk input yields no rows, newest first, limited', () => {
    expect(paymentRows([tx({ amountPaid: 0 }), tx({ orderId: '' , transactionId: undefined, id: undefined})])).toEqual([]);
    expect(paymentRows(null)).toEqual([]);
    expect(paymentRows('x')).toEqual([]);
    expect(paymentRows([null, 1, 'a'])).toEqual([]);
    const many = Array.from({ length: 8 }, (_, i) => tx({ orderId: `o${i}`, createdAt: new Date(2026, 9, i + 1).toISOString() }));
    const r = paymentRows(many, 3);
    expect(r.map((x) => x.reference)).toEqual(['o7', 'o6', 'o5']);
  });

  it('reads a Firestore-style timestamp', () => {
    const [r] = paymentRows([tx({ createdAt: { seconds: 1_760_000_000 } })]);
    expect(r.whenMs).toBe(1_760_000_000_000);
  });
});
