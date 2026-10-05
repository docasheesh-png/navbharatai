// Q-613 (forensic audit 2026-10-04) — a paid order is never left claimed but uncredited.
//
// The PENDING→SUCCESS claim and the wallet credit used to be two transactions. A process that died
// between them left the order SUCCESS with nothing credited, and every later call — the webhook's retry,
// the buyer's own check, the reconcile sweep (which reads only PENDING) — answered "already processed".
// These tests run the real `verifyPaymentInternal` against an in-memory store and make the credit fail
// once, exactly where the process used to die.

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
// fake gateway answers PAID for the recorded amount.
vi.mock('axios', () => ({
  default: { get: vi.fn(async () => ({ data: { order_status: 'PAID', order_amount: 100, cf_order_id: 'cf_1' } })) },
}));

process.env.CASHFREE_CLIENT_ID = 'live_client_id_for_tests';
process.env.CASHFREE_CLIENT_SECRET = 'live_client_secret_for_tests';
process.env.CASHFREE_ENV = 'production';

import { verifyPaymentInternal } from '../src/server/lib/payments';

beforeEach(() => { store.clear(); failNextWalletWrite = false; mintCalls = 0; });

const order = (id: string, extra: Doc = {}) =>
  store.set(`payment_transactions/${id}`, { userId: 'buyer', amountPaid: 100, balanceAdded: 100, paymentStatus: 'PENDING', ...extra });
const wallet = () => store.get('user_token_wallets/buyer');

describe('a wallet top-up is claimed and credited together, or not at all', () => {
  it('a failure during the credit leaves the order PENDING, and the next call credits it', async () => {
    order('ord_a');
    failNextWalletWrite = true;
    const first = await verifyPaymentInternal('ord_a');
    expect(first.success).toBe(false);
    expect(store.get('payment_transactions/ord_a')!.paymentStatus).toBe('PENDING'); // NOT claimed
    expect(wallet()).toBeUndefined();

    const retry = await verifyPaymentInternal('ord_a'); // the webhook's retry
    expect(retry.success).toBe(true);
    expect(retry.data.alreadyProcessed).toBeUndefined();
    expect(store.get('payment_transactions/ord_a')!.paymentStatus).toBe('SUCCESS');
    expect(wallet()!.tokenBalance).toBeGreaterThan(0);
  });

  it('exactly once: a second call after a success credits nothing more', async () => {
    order('ord_b');
    await verifyPaymentInternal('ord_b');
    const balance = wallet()!.tokenBalance;
    const again = await verifyPaymentInternal('ord_b');
    expect(again.data.alreadyProcessed).toBe(true);
    expect(wallet()!.tokenBalance).toBe(balance);
  });
});

describe('a gift order claimed but never minted is finished, not reported done', () => {
  it('SUCCESS with no code → the next call mints (idempotently) and returns the code', async () => {
    // The state the old crash left: claimed, no code, no error.
    order('ord_g', { paymentStatus: 'SUCCESS', productType: 'gift_code', giftFaceInr: 500, balanceAdded: 0 });
    const r = await verifyPaymentInternal('ord_g');
    expect(r.success).toBe(true);
    expect(r.data.giftCode).toBe('NBGIFT-ord_g');
    expect(store.get('payment_transactions/ord_g')!.giftCode).toBe('NBGIFT-ord_g');
    expect(wallet()).toBeUndefined(); // a gift credits nobody
  });

  it('a gift order that already carries its code is simply done', async () => {
    order('ord_h', { paymentStatus: 'SUCCESS', productType: 'gift_code', giftFaceInr: 500, giftCode: 'NBGIFT-ord_h' });
    const r = await verifyPaymentInternal('ord_h');
    expect(r.data.alreadyProcessed).toBe(true);
    expect(mintCalls).toBe(0);
  });
});
