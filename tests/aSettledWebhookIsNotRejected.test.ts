// Q-888 — A SETTLED PAYMENT EVENT IS ACKNOWLEDGED, NOT REJECTED.
//
// 🔴 THE DEFECT. The signed-webhook route answered **400** to every `success: false` from
// `verifyPaymentInternal`. Cashfree re-delivers a non-2xx, so an order the gateway itself had told us was
// PAYMENT_FAILED or USER_DROPPED — which the verifier settles as EXPIRED, exactly as it should — was
// answered 400 and sent again, and again, and again. The retry was not a symptom of anything being
// wrong: it was us refusing to acknowledge an answer we had already given.
//
// 🔑 THE CLASS: THE ROUTE COULD NOT TELL A DECISION FROM AN OUTAGE, BECAUSE THE FUNCTION DID NOT SAY.
// Both arrive as `{ success: false, error }`, and no amount of care at the call site can separate "this
// order will never be fulfilled and that is the answer" from "we could not reach the database". So the
// fix is not a cleverer route — it is `settled` on the verifier's own result, which is the only place
// that knows. The route merely reads it.
//
// ⚠️ AND THE DEFAULT IS THE WHOLE SAFETY ARGUMENT. An unflagged failure is RETRYABLE, never settled:
// acknowledging an event we could not complete LOSES it, and a lost payment event costs a customer their
// credit. So the dangerous direction has to be chosen explicitly, and the census below fails if a new
// failure return omits the field — a future `return { success: false, … }` cannot inherit either
// behaviour by accident, which is how this bug would otherwise come back.
//
// These tests drive the REAL route through the REAL verifier against an in-memory Firestore and a fake
// gateway, so what they assert is the HTTP status Cashfree would actually receive.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

type Doc = Record<string, any>;
const store = new Map<string, Doc>();
let dbAvailable = true;

vi.mock('../src/server/lib/serverDb', () => {
  const key = (ref: { col: string; id: string }) => `${ref.col}/${ref.id}`;
  const snap = (ref: { col: string; id: string }) => {
    const d = store.get(key(ref));
    return { exists: () => d !== undefined, data: () => (d ? structuredClone(d) : undefined) };
  };
  return {
    // `null` is how the verifier sees "no database", which is its own retryable case.
    getServerDb: () => (dbAvailable ? {} : null),
    doc: (_db: unknown, col: string, id: string) => ({ col, id }),
    getDoc: async (ref: { col: string; id: string }) => snap(ref),
    setDoc: async (ref: { col: string; id: string }, data: Doc) => { store.set(key(ref), structuredClone(data)); },
    updateDoc: async (ref: { col: string; id: string }, patch: Doc) => { store.set(key(ref), { ...(store.get(key(ref)) ?? {}), ...patch }); },
    collection: () => ({}), query: () => ({}), where: () => ({}), limit: () => ({}),
    getDocs: async () => ({ docs: [] }),
    runTransaction: async (_db: unknown, body: (tx: any) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (ref: { col: string; id: string }) => snap(ref),
        update: (ref: { col: string; id: string }, patch: Doc) => writes.push(() => store.set(key(ref), { ...(store.get(key(ref)) ?? {}), ...structuredClone(patch) })),
        set: (ref: { col: string; id: string }, data: Doc) => writes.push(() => store.set(key(ref), structuredClone(data))),
      };
      const out = await body(tx);
      for (const w of writes) w();
      return out;
    },
  };
});

/** What the gateway says when asked about the order. Every test sets this, because it is the fact under test. */
const gateway = { order: { order_status: 'PAID', order_amount: 102, cf_order_id: 'cf_1' } as Doc };
vi.mock('axios', () => ({
  default: {
    get: vi.fn(async () => ({ data: structuredClone(gateway.order) })),
    post: vi.fn(),
  },
}));

const SECRET = 'whsec_for_tests';
process.env.CASHFREE_CLIENT_ID = 'live_client_id_for_tests';
process.env.CASHFREE_CLIENT_SECRET = 'live_client_secret_for_tests';
process.env.CASHFREE_ENV = 'production';
process.env.CASHFREE_WEBHOOK_SECRET = SECRET;
process.env.VITEST = 'true';

import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { registerPaymentRoutes } from '../src/server/routes/payment';

const webhook = captureRoutes(registerPaymentRoutes, () => {}).get('POST /api/payment/webhook')!;

/** A genuinely signed PAYMENT event for one order — the path that used to answer 400 for everything. */
async function deliverPayment(orderId: string, type = 'PAYMENT_SUCCESS_WEBHOOK', payment?: Doc) {
  const body = { type, data: { order: { order_id: orderId }, ...(payment ? { payment } : {}) } };
  const raw = JSON.stringify(body);
  const req = mockReq({ body, headers: { 'x-cf-signature': crypto.createHmac('sha256', SECRET).update(raw).digest('base64') } });
  req.rawBody = Buffer.from(raw, 'utf8');
  const res = mockRes();
  await webhook(req, res);
  return res;
}

const pendingOrder = (id: string, extra: Doc = {}) =>
  store.set(`payment_transactions/${id}`, { userId: 'buyer', amountPaid: 102, balanceAdded: 100, platformFeeInr: 2, paymentStatus: 'PENDING', productType: 'wallet', ...extra });

beforeEach(() => {
  store.clear();
  dbAvailable = true;
  gateway.order = { order_status: 'PAID', order_amount: 102, cf_order_id: 'cf_1' };
});

describe('an event the gateway has settled is acknowledged, so it stops coming back', () => {
  it('🔴 THE INCIDENT, MODELLED AS CASHFREE ACTUALLY SENDS IT: a dropped ATTEMPT on a still-open order', async () => {
    // ⚠️ A first version of this test set `order_status: 'USER_DROPPED'`, and the row describes it that
    // way too. That is not a thing: USER_DROPPED and FAILED are PAYMENT statuses, and the ORDER stays
    // ACTIVE because the payer may try again. Modelling it wrongly would have "proved" a fix that does
    // not touch the case the admin reported.
    pendingOrder('ord_dropped');
    gateway.order = { order_status: 'ACTIVE' };
    const res = await deliverPayment('ord_dropped', 'PAYMENT_USER_DROPPED_WEBHOOK', { payment_status: 'USER_DROPPED' });

    expect(res.statusCode, 'a non-2xx here is what made Cashfree re-send this event for ever').toBe(200);
    expect(res.body.status).toBe('ATTEMPT_FAILED');
    // The order is NOT closed: a later attempt must still be able to pay it.
    expect(store.get('payment_transactions/ord_dropped')!.paymentStatus).toBe('PENDING');
    expect(store.get('user_token_wallets/buyer')).toBeUndefined();
  });

  it('a FAILED attempt is acknowledged the same way, and recognised from the payment object alone', async () => {
    pendingOrder('ord_failed');
    gateway.order = { order_status: 'ACTIVE' };
    // No recognisable event NAME — only the payment object's status. Substring matching must still catch it.
    const res = await deliverPayment('ord_failed', 'SOME_RENAMED_EVENT', { payment_status: 'FAILED' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ATTEMPT_FAILED');
    expect(store.get('payment_transactions/ord_failed')!.paymentStatus).toBe('PENDING');
  });

  it('an EXPIRED order IS settled — closed by the gateway, recorded, acknowledged', async () => {
    pendingOrder('ord_expired');
    gateway.order = { order_status: 'EXPIRED' };
    const res = await deliverPayment('ord_expired');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('SETTLED');
    expect(store.get('payment_transactions/ord_expired')!.paymentStatus).toBe('EXPIRED');
  });

  it('a SUCCESS event we cannot fulfil on a still-open order is NOT acknowledged — it may yet be paid', async () => {
    pendingOrder('ord_active');
    gateway.order = { order_status: 'ACTIVE' };
    const res = await deliverPayment('ord_active');
    expect(res.statusCode, 'the order is still payable, so this delivery must come back').toBe(502);
    expect(store.get('payment_transactions/ord_active')!.paymentStatus).toBe('PENDING');
  });

  it('an order this server never created is settled, not retried for ever', async () => {
    const res = await deliverPayment('ord_not_ours');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('SETTLED');
  });

  it('an amount mismatch is a decision, so it is acknowledged — and nothing is credited', async () => {
    pendingOrder('ord_mismatch');
    gateway.order = { order_status: 'PAID', order_amount: 5000, cf_order_id: 'cf_x' }; // we recorded 102
    const res = await deliverPayment('ord_mismatch');
    expect(res.statusCode).toBe(200);
    expect(store.get('user_token_wallets/buyer'), 'a refused credit must still credit nothing').toBeUndefined();
    expect(store.get('payment_transactions/ord_mismatch')!.paymentStatus).toBe('PENDING');
  });

  it('Q-1226: an unreadable stored amount is credited consistently and acknowledged once', async () => {
    pendingOrder('ord_legacy', { amountPaid: 'legacy', balanceAdded: 999 });
    const first = await deliverPayment('ord_legacy');
    expect(first.statusCode).toBe(200);
    expect(first.body.status).toBe('OK');
    expect(store.get('user_token_wallets/buyer')).toMatchObject({ tokenBalance: 10000, remaining_balance: 100 });
    expect(store.get('payment_transactions/ord_legacy')).toMatchObject({ amountPaid: 102, balanceAdded: 100, paymentStatus: 'SUCCESS', unreconciledCredit: true });
    const again = await deliverPayment('ord_legacy');
    expect(again.statusCode).toBe(200);
    expect(store.get('user_token_wallets/buyer')!.walletLedger).toHaveLength(1);
  });

  it('a genuine payment is still fulfilled and answered 200 — the fix changes no happy path', async () => {
    pendingOrder('ord_ok');
    const res = await deliverPayment('ord_ok');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(store.get('user_token_wallets/buyer')!.tokenBalance).toBeGreaterThan(0);
  });
});

describe('an event we could NOT complete is never acknowledged', () => {
  it('no database ⇒ 502, so the gateway delivers it again', async () => {
    pendingOrder('ord_nodb');
    dbAvailable = false;
    const res = await deliverPayment('ord_nodb');
    expect(res.statusCode, 'acknowledging this would lose the payment event').toBe(502);
  });

  it('a PAID order whose own amount cannot be read ⇒ 502, and nothing is credited', async () => {
    pendingOrder('ord_unreadable');
    gateway.order = { order_status: 'PAID', order_amount: 'not-a-number', cf_order_id: 'cf_y' };
    const res = await deliverPayment('ord_unreadable');
    expect(res.statusCode).toBe(502);
    expect(store.get('user_token_wallets/buyer')).toBeUndefined();
    expect(store.get('payment_transactions/ord_unreadable')!.paymentStatus).toBe('PENDING');
  });

  it('502 and not 400: a retryable failure is OURS, not a malformed request', () => {
    // 🔑 SCOPED TO THE WEBHOOK HANDLER ON PURPOSE. `/api/payment/verify-payment` answers the BROWSER, and
    // a 400 there is right: the caller asked about an order that cannot be fulfilled. A first draft of
    // this assertion read the whole file and failed on that line — flagging correct code in a different
    // route, which is how a guard teaches the next person to make the wrong edit.
    const file = stripCodeComments(readFileSync(join(process.cwd(), 'src/server/routes/payment.ts'), 'utf8'));
    const start = file.indexOf("app.post('/api/payment/webhook'");
    expect(start, 'the webhook route moved — this guard went blind').toBeGreaterThan(-1);
    const handler = file.slice(start, file.indexOf("app.post(", start + 20));
    expect(handler, 'the webhook must not answer 400 to a fulfilment failure any more')
      .not.toMatch(/res\.status\(400\)\.json\(\{\s*error:\s*result\.error\s*\}\)/);
    expect(handler).toContain("res.status(200).json({ status: 'SETTLED' })");
    expect(handler).toContain('res.status(502)');
  });
});

describe('🔒 THE CLASS: every failure the verifier returns says whether it is settled', () => {
  const CODE = stripCodeComments(readFileSync(join(process.cwd(), 'src/server/lib/payments.ts'), 'utf8'));
  /** `verifyPaymentInternal`'s body — the one function whose result the webhook maps to a status. */
  const BODY = (() => {
    const start = CODE.indexOf('export async function verifyPaymentInternal(');
    expect(start, 'verifyPaymentInternal not found — this census went blind').toBeGreaterThan(-1);
    const next = CODE.indexOf('\nexport ', start + 10);
    return CODE.slice(start, next === -1 ? undefined : next);
  })();

  it('the census found the failure returns at all — it is not passing vacuously', () => {
    const failures = BODY.match(/return \{ success: false[^;]*;/g) ?? [];
    expect(failures.length, 'no failure returns found; the shape changed and this guard is blind').toBeGreaterThanOrEqual(6);
  });

  it('each one states `settled` explicitly, so a new failure cannot inherit either behaviour', () => {
    const failures = BODY.match(/return \{ success: false[^;]*;/g) ?? [];
    const silent = failures.filter((f) => !/settled:\s*(true|false)/.test(f)).map((f) => f.slice(0, 120));
    expect(silent, 'add `settled: true` (a decision) or `settled: false` (retryable) — see the docblock').toEqual([]);
  });

  it('and both kinds exist — a file where everything is settled would pass vacuously too', () => {
    const failures = BODY.match(/return \{ success: false[^;]*;/g) ?? [];
    expect(failures.some((f) => /settled:\s*true/.test(f)), 'no settled failure at all').toBe(true);
    expect(failures.some((f) => /settled:\s*false/.test(f)), 'no retryable failure at all').toBe(true);
  });
});
