/**
 * WHO PAID, FOR WHAT, AND WHICH ROWS ARE REVENUE — `purchaseLedger.ts` (admin 2026-09-17).
 *
 * The failure this pins: the admin Revenue tile "Token Purchases — successful payments" counted a
 * coupon redemption (a SUCCESS row with amountPaid 0) as a payment, and the recent-purchases table
 * showed a truncated user id with no product, status, method or transaction id.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  purchaseRow, isRevenueRow, purchaseKind, purchaseTokens, normalisePurchaseStatus,
  summarisePurchases, filterPurchases, sortPurchases, type PurchaseRowWithUser,
} from '../src/server/lib/purchaseLedger';
import { TOKENS_PER_RUPEE } from '../src/lib/walletPricing';

const recharge = {
  transactionId: 'ord_nb_1', userId: 'u1', amountPaid: 499, balanceAdded: 489.02, platformFeeInr: 9.98, platformFeePct: 2,
  productType: 'wallet', paymentProvider: 'CASHFREE', paymentStatus: 'SUCCESS', paymentReference: 'cf_123', createdAt: '2026-09-17T10:00:00.000Z',
};
const pending = { ...recharge, transactionId: 'ord_nb_2', paymentStatus: 'PENDING', paymentReference: '', createdAt: '2026-09-17T11:00:00.000Z' };
const coupon = {
  transactionId: 'coupon_X_u2', userId: 'u2', amountPaid: 0, balanceAdded: 50, paymentProvider: 'COUPON_REDEEM',
  paymentStatus: 'SUCCESS', paymentReference: 'REDEMPTION_DIWALI50', createdAt: '2026-09-16T09:00:00.000Z',
};
const welcome = { transactionId: 'wb_u3', userId: 'u3', amountPaid: 0, balanceAdded: 500, paymentProvider: 'WELCOME_BONUS', paymentStatus: 'SUCCESS', createdAt: '2026-09-15T09:00:00.000Z' };
const store = {
  transactionId: 'gplay_abc', userId: 'u4', amountPaid: 99, balanceAdded: 99, storePriceInr: 119, storeFeePct: 15, storeNetInr: 101.15,
  paymentProvider: 'GOOGLE_PLAY', paymentStatus: 'SUCCESS', paymentReference: 'GPA.1234', productId: 'nbai.tokens.99', createdAt: '2026-09-17T12:00:00.000Z',
};
const pass = { ...recharge, transactionId: 'ord_nb_5', userId: 'u5', amountPaid: 299, balanceAdded: 0, productType: 'professional_pass', passPlan: 'monthly', passDays: 30, createdAt: '2026-09-14T10:00:00.000Z' };
const legacy = { transactionId: 'ord_old', userId: 'u6', amountPaid: 150, tokenAmount: 15000, paymentProvider: 'CASHFREE', paymentStatus: 'SUCCESS', createdAt: '2026-07-01T10:00:00.000Z' };

describe('the one revenue rule', () => {
  it('a successful paid recharge is revenue', () => expect(isRevenueRow(recharge)).toBe(true));
  it('a PENDING order is not revenue, however large', () => expect(isRevenueRow(pending)).toBe(false));
  it('a coupon redemption is a SUCCESS row and is NOT revenue — the tile used to count it', () => expect(isRevenueRow(coupon)).toBe(false));
  it('the welcome gift is not revenue', () => expect(isRevenueRow(welcome)).toBe(false));
  it('a store pack is revenue at what we recorded as paid', () => {
    expect(isRevenueRow(store)).toBe(true);
    expect(purchaseRow('gplay_abc', store).amountInr).toBe(99);
    expect(purchaseRow('gplay_abc', store).storePriceInr).toBe(119);
  });
  it('a Professional Pass is revenue with zero wallet credit', () => {
    const r = purchaseRow('ord_nb_5', pass);
    expect(r.revenue).toBe(true);
    expect(r.kind).toBe('pass');
    expect(r.tokens).toBe(0);
    expect(r.product).toContain('Professional Pass');
    expect(r.product).toContain('monthly');
  });
  it('a paid row on an unknown rail is still money that arrived', () => {
    expect(isRevenueRow({ ...recharge, paymentProvider: 'RAZORPAY' })).toBe(true);
  });
  it('a FAILED or CANCELLED row is never revenue', () => {
    expect(isRevenueRow({ ...recharge, paymentStatus: 'FAILED' })).toBe(false);
    expect(normalisePurchaseStatus('CANCELLED')).toBe('FAILED');
    expect(normalisePurchaseStatus('USER_DROPPED')).toBe('FAILED');
  });
});

describe('the row the admin sees', () => {
  it('carries every field the Revenue table needs, from the real document', () => {
    const r = purchaseRow('ord_nb_1', recharge);
    expect(r).toMatchObject({
      id: 'ord_nb_1', userId: 'u1', kind: 'recharge', product: 'Wallet recharge', amountInr: 499, currency: 'INR',
      creditInr: 489.02, status: 'SUCCESS', transactionId: 'ord_nb_1', gatewayReference: 'cf_123',
      method: 'Cashfree (web)', platformFeeInr: 9.98, revenue: true,
    });
    expect(r.tokens).toBe(Math.round(489.02 * TOKENS_PER_RUPEE));
    expect(r.atMs).toBe(Date.parse(recharge.createdAt));
  });
  it('tokens come from balanceAdded — the field every credit path writes — and fall back to the legacy tokenAmount', () => {
    expect(purchaseTokens(recharge)).toBe(Math.round(489.02 * TOKENS_PER_RUPEE));
    expect(purchaseTokens(legacy)).toBe(15000);
    expect(purchaseRow('ord_old', legacy).tokens).toBe(15000);
  });
  it('names the rail and the product without leaking a gateway internal', () => {
    expect(purchaseRow('c', coupon).method).toBe('Coupon');
    expect(purchaseRow('c', coupon).product).toBe('Coupon DIWALI50');
    expect(purchaseRow('w', welcome).product).toBe('Welcome gift');
    expect(purchaseRow('g', store).method).toBe('Google Play');
    expect(purchaseKind({ paymentProvider: 'APPLE_IAP' })).toBe('store');
  });
  it('a malformed document becomes an honest empty row, never a throw', () => {
    const r = purchaseRow('x', null);
    expect(r.amountInr).toBe(0);
    expect(r.status).toBe('PENDING');
    expect(r.revenue).toBe(false);
    expect(r.atMs).toBe(0);
  });
});

describe('summary, filter and sort', () => {
  const rows: PurchaseRowWithUser[] = [
    { ...purchaseRow('ord_nb_1', recharge), email: 'a@x.in', name: 'Asha' },
    { ...purchaseRow('ord_nb_2', pending), email: 'a@x.in', name: 'Asha' },
    { ...purchaseRow('coupon_X_u2', coupon), email: 'b@x.in', name: 'Bala' },
    { ...purchaseRow('wb_u3', welcome), email: '', name: '' },
    { ...purchaseRow('gplay_abc', store), email: 'd@x.in', name: 'Dev' },
    { ...purchaseRow('ord_old', legacy), email: 'f@x.in', name: 'Farah' },
  ];

  it('revenue is the sum of paid rows only; free credit, pending and failed are counted separately', () => {
    const s = summarisePurchases(rows);
    expect(s.revenueInr).toBe(499 + 99 + 150);
    expect(s.revenueRows).toBe(3);
    expect(s.pendingRows).toBe(1);
    expect(s.freeCreditRows).toBe(2);
    expect(s.refundTracked).toBe(false);
  });
  it('default order is latest first', () => {
    const ids = sortPurchases(rows).map((r) => r.id);
    expect(ids[0]).toBe('gplay_abc');
    expect(ids[ids.length - 1]).toBe('ord_old');
  });
  it('sorts by amount and by tokens, both directions', () => {
    expect(sortPurchases(rows, 'amount', 'desc')[0].id).toBe('ord_nb_1');
    expect(sortPurchases(rows, 'amount', 'asc')[0].amountInr).toBe(0);
    // The welcome gift credited 50,000 tokens — more than the ₹499 recharge — so by TOKENS it leads.
    expect(sortPurchases(rows, 'tokens', 'desc')[0].id).toBe('wb_u3');
    expect(sortPurchases(rows, 'tokens', 'desc')[1].id).toBe('ord_nb_1');
  });
  it('filters by status, date range and search over user, email, name and transaction id', () => {
    expect(filterPurchases(rows, { status: 'revenue' }).map((r) => r.id).sort()).toEqual(['gplay_abc', 'ord_nb_1', 'ord_old']);
    expect(filterPurchases(rows, { status: 'free' }).map((r) => r.id).sort()).toEqual(['coupon_X_u2', 'wb_u3']);
    expect(filterPurchases(rows, { status: 'pending' }).map((r) => r.id)).toEqual(['ord_nb_2']);
    expect(filterPurchases(rows, { from: '2026-09-17', to: '2026-09-17' }).map((r) => r.id).sort()).toEqual(['gplay_abc', 'ord_nb_1', 'ord_nb_2']);
    expect(filterPurchases(rows, { search: 'bala' }).map((r) => r.id)).toEqual(['coupon_X_u2']);
    expect(filterPurchases(rows, { search: 'GPA.1234' }).map((r) => r.id)).toEqual(['gplay_abc']);
    expect(filterPurchases(rows, { search: 'u6' }).map((r) => r.id)).toEqual(['ord_old']);
  });
});

describe('wiring — proven by reading the routes with comments stripped', () => {
  const code = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').split('\n')
    .filter((l) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); }).join('\n');

  it('the admin purchases endpoint exists, is admin-gated, and reads through the shared ledger', () => {
    const src = code('src/server/routes/admin.ts');
    const at = src.indexOf("app.get('/api/admin/purchases', verifyAdminToken");
    expect(at).toBeGreaterThan(-1);
    const handler = src.slice(at, src.indexOf("app.get('/api/admin/users'", at));
    expect(handler).toContain('purchaseRow(');
    expect(handler).toContain('filterPurchases(');
    expect(handler).toContain('sortPurchases(');
    expect(handler).toContain('summarisePurchases(');
  });
  it('the analytics tiles count payments with the SAME revenue rule, not a private WELCOME_BONUS exclusion', () => {
    const src = code('src/server/routes/admin.ts');
    expect(src).toContain('transactions.filter((tx: any) => isRevenueRow(tx))');
    expect(src).not.toContain("tx.paymentStatus === 'SUCCESS' && tx.paymentProvider !== 'WELCOME_BONUS'");
  });
  it('the account sheet lists purchases and a credits summary through the same modules', () => {
    const src = code('src/server/routes/reports.ts');
    const at = src.indexOf("app.get('/api/admin/users/:uid/account'");
    const handler = src.slice(at, src.indexOf("app.post('/api/admin/reports/:id/status'", at));
    expect(handler).toContain('purchases:');
    expect(handler).toContain('purchaseRow(');
    expect(handler).toContain('usage:');
    expect(handler).toContain('summariseChatTokens(');
    expect(handler).toContain('buildWalletStatement(');
  });
});
