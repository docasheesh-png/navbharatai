// DB-5 (go-live audit 2026-10-13): Cashfree-closed orders settle as EXPIRED; the sweep reads newest first.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Doc = Record<string, any>;
const store = new Map<string, Doc>();
let failNextWalletWrite = false;
let mintCalls = 0;

vi.mock('../src/server/lib/serverDb', () => {
  const key = (ref: { col: string; id: string }) => `${ref.col}/${ref.id}`;
  const snap = (ref: { col: string; id: string }) => {
    const d = store.get(key(ref));
    return { exists: () => d !== undefined, data: () => (d ? structuredClone(d) : undefined) };
  };
  return {
    getServerDb: () => ({}),
    doc: (_db: unknown, col: string, id: string) => ({ col, id }),
    getDoc: async (ref: { col: string; id: string }) => snap(ref),
    updateDoc: async (ref: { col: string; id: string }, patch: Doc) => { store.set(key(ref), { ...(store.get(key(ref)) ?? {}), ...patch }); },
    // A transaction: reads see the committed state; writes are buffered and applied only if the body
    // returns. A throw anywhere discards every buffered write — Firestore's guarantee.
    runTransaction: async (_db: unknown, body: (tx: any) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (ref: { col: string; id: string }) => snap(ref),
        update: (ref: { col: string; id: string }, patch: Doc) => writes.push(() => store.set(key(ref), { ...(store.get(key(ref)) ?? {}), ...patch })),
        set: (ref: { col: string; id: string }, data: Doc) => writes.push(() => {
          if (ref.col === 'user_token_wallets' && failNextWalletWrite) { failNextWalletWrite = false; throw new Error('process died here'); }
          store.set(key(ref), structuredClone(data));
        }),
      };
      const out = await body(tx);
      const before = new Map(store); // commit all-or-nothing, as Firestore does
      try { for (const w of writes) w(); } catch (e) { store.clear(); for (const [k, v] of before) store.set(k, v); throw e; }
      return out;
    },
  };
});

vi.mock('../src/server/lib/giftCodeStore', () => ({
  // Idempotent on the order id, like the real store.
  mintCodeForOrder: async (_db: unknown, o: { orderId: string }) => { mintCalls++; return `NBGIFT-${o.orderId}`; },
}));

// Cashfree itself is the only thing that can say an order was paid (there is no simulator — Q-615). The
let cfStatus = 'EXPIRED';
vi.mock('axios', () => ({
  default: { get: vi.fn(async () => ({ data: { order_status: cfStatus, order_amount: 100, cf_order_id: 'cf_1' } })) },
}));
process.env.CASHFREE_CLIENT_ID = 'live_client_id_for_tests';
process.env.CASHFREE_CLIENT_SECRET = 'live_client_secret_for_tests';
process.env.CASHFREE_ENV = 'production';

import { readFileSync } from 'fs';
import { verifyPaymentInternal } from '../src/server/lib/payments';
import { cashfreeOrderClosedUnpaid } from '../src/server/lib/pendingOrders';

beforeEach(() => { store.clear(); failNextWalletWrite = false; mintCalls = 0; cfStatus = 'EXPIRED'; });
const order = (id: string, extra: Doc = {}) =>
  store.set(`payment_transactions/${id}`, { userId: 'buyer', amountPaid: 100, balanceAdded: 100, paymentStatus: 'PENDING', ...extra });

describe('cashfreeOrderClosedUnpaid', () => {
  it('only EXPIRED and TERMINATED are closed', () => {
    expect(cashfreeOrderClosedUnpaid('EXPIRED')).toBe(true);
    expect(cashfreeOrderClosedUnpaid('terminated')).toBe(true);
    for (const s of ['ACTIVE', 'PAID', 'TERMINATION_REQUESTED', '', undefined, 'SOMETHING_NEW']) expect(cashfreeOrderClosedUnpaid(s)).toBe(false);
  });
});

describe('verifyPaymentInternal settles a closed order', () => {
  it('EXPIRED at Cashfree → EXPIRED here, nothing credited', async () => {
    order('ord_x');
    const r = await verifyPaymentInternal('ord_x');
    expect(r.success).toBe(false);
    expect(store.get('payment_transactions/ord_x')!.paymentStatus).toBe('EXPIRED');
    expect(store.get('user_token_wallets/buyer')).toBeUndefined();
  });
  it('ACTIVE stays PENDING', async () => {
    cfStatus = 'ACTIVE';
    order('ord_y');
    await verifyPaymentInternal('ord_y');
    expect(store.get('payment_transactions/ord_y')!.paymentStatus).toBe('PENDING');
  });
  it('a SUCCESS order is never downgraded', async () => {
    order('ord_z', { paymentStatus: 'SUCCESS' });
    await verifyPaymentInternal('ord_z');
    expect(store.get('payment_transactions/ord_z')!.paymentStatus).toBe('SUCCESS');
  });
});

describe('reconcile reads newest PENDING orders, not the 50 oldest ids', () => {
  it('uses the index-safe newest-first listing', () => {
    const src = readFileSync('src/server/routes/payment.ts', 'utf8');
    const block = src.slice(src.indexOf("'/api/payment/reconcile'"), src.indexOf("'/api/payment/webhook'"));
    expect(block).toContain('listEqNewestFirst');
    expect(block).not.toMatch(/where\('paymentStatus', '==', 'PENDING'\), limit\(50\)/);
  });
});
