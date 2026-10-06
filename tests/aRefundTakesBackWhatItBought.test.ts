// Q-614 (admin decision 2026-10-05, option a) — a refund or a chargeback takes back the tokens that
// payment bought, down to zero and never below.
//
// Before this, every signed Cashfree webhook went to `verifyPaymentInternal` ("fulfil this order"), so
// a refund was handled as if money had arrived and the tokens stayed in the wallet. These tests drive the
// REAL webhook route and the REAL payment code against an in-memory Firestore (all-or-nothing
// transactions) and a fake Cashfree API, and the amounts the gateway reports are the only amounts used.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

type Doc = Record<string, any>;
const store = new Map<string, Doc>();

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
    setDoc: async (ref: { col: string; id: string }, data: Doc) => { store.set(key(ref), structuredClone(data)); },
    updateDoc: async (ref: { col: string; id: string }, patch: Doc) => { store.set(key(ref), { ...(store.get(key(ref)) ?? {}), ...patch }); },
    collection: () => ({}), query: () => ({}), where: () => ({}), limit: () => ({}),
    getDocs: async () => ({ docs: [] }),
    // A transaction: every read precedes every write (Firestore's rule, enforced here so a read-after-
    // write would fail the test), writes are buffered and committed all-or-nothing.
    runTransaction: async (_db: unknown, body: (tx: any) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (ref: { col: string; id: string }) => {
          if (writes.length) throw new Error('Firestore transactions require all reads before all writes');
          return snap(ref);
        },
        update: (ref: { col: string; id: string }, patch: Doc) => writes.push(() => {
          if (!store.has(key(ref))) throw new Error(`update of missing doc ${key(ref)}`);
          store.set(key(ref), { ...store.get(key(ref)), ...structuredClone(patch) });
        }),
        set: (ref: { col: string; id: string }, data: Doc) => writes.push(() => store.set(key(ref), structuredClone(data))),
      };
      const out = await body(tx);
      const before = new Map(store);
      try { for (const w of writes) w(); } catch (e) { store.clear(); for (const [k, v] of before) store.set(k, v); throw e; }
      return out;
    },
  };
});

// The fake Cashfree API. `gateway` is the AUTHORITATIVE state; webhook bodies may say anything.
const gateway = {
  order: { order_status: 'PAID', order_amount: 102, cf_order_id: 'cf_1' } as Doc,
  refunds: [] as Doc[],
  disputes: [] as Doc[],
  refundsFail: false,
  disputesStatus: 200,
};
const getCalls: string[] = [];
vi.mock('axios', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      getCalls.push(url);
      if (url.endsWith('/refunds')) {
        if (gateway.refundsFail) throw Object.assign(new Error('boom'), { response: { status: 500 } });
        return { data: structuredClone(gateway.refunds) };
      }
      if (url.endsWith('/disputes')) {
        if (gateway.disputesStatus !== 200) throw Object.assign(new Error('nf'), { response: { status: gateway.disputesStatus } });
        return { data: structuredClone(gateway.disputes) };
      }
      return { data: structuredClone(gateway.order) };
    }),
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
import { verifyPaymentInternal } from '../src/server/lib/payments';
import {
  classifyCashfreeWebhook, cashfreeWebhookOrderId, sumSuccessfulRefundsInr, sumLostDisputesInr,
  clawbackTargetTokens, clawbackDeltaTokens, computeClawedBackWallet, isLostDisputeStatus,
} from '../src/server/lib/paymentReversal';
import { decideGiftRedemption, type GiftCodeRecord } from '../src/server/lib/giftCodes';
import { purchaseRow, summarisePurchases } from '../src/server/lib/purchaseLedger';
import { buildWalletStatement } from '../src/server/lib/walletStatement';

const webhook = captureRoutes(registerPaymentRoutes, () => {}).get('POST /api/payment/webhook')!;

async function deliver(body: Doc, opts: { sign?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const signature = opts.sign === false ? 'forged' : crypto.createHmac('sha256', SECRET).update(raw).digest('base64');
  const req = mockReq({ body, headers: { 'x-cf-signature': signature } });
  req.rawBody = Buffer.from(raw, 'utf8');
  const res = mockRes();
  await webhook(req, res);
  return res;
}

const refundEvent = (orderId: string, bodyAmount = 102, bodyStatus = 'SUCCESS') => ({
  type: 'REFUND_STATUS_WEBHOOK',
  data: { refund: { order_id: orderId, refund_amount: bodyAmount, refund_status: bodyStatus, cf_refund_id: 'r_body' } },
});
const disputeEvent = (orderId: string, type = 'DISPUTE_CLOSED') => ({
  type,
  data: { dispute: { dispute_id: 'd1', dispute_amount: 102, dispute_status: 'CHARGEBACK_MERCHANT_LOST' }, order_details: { order_id: orderId } },
});

/** A credited ₹102 order (₹2 platform fee → ₹100 → 10,000 tokens) in a wallet holding `tokens`. */
function creditedOrder(id: string, tokens: number, extra: Doc = {}) {
  store.set(`payment_transactions/${id}`, {
    userId: 'buyer', amountPaid: 102, balanceAdded: 100, platformFeeInr: 2,
    paymentStatus: 'SUCCESS', paymentProvider: 'CASHFREE', productType: 'wallet', ...extra,
  });
  store.set('user_token_wallets/buyer', {
    userId: 'buyer', tokenBalance: tokens, remaining_balance: tokens / 100, total_balance: tokens / 100,
    totalTokensPurchased: 10_000, walletLedger: [], giftTokensRemaining: 0,
  });
}
const wallet = (uid = 'buyer') => store.get(`user_token_wallets/${uid}`)!;
const order = (id: string) => store.get(`payment_transactions/${id}`)!;
const lastRow = (uid = 'buyer') => wallet(uid).walletLedger.at(-1);

beforeEach(() => {
  store.clear();
  getCalls.length = 0;
  gateway.order = { order_status: 'PAID', order_amount: 102, cf_order_id: 'cf_1' };
  gateway.refunds = [];
  gateway.disputes = [];
  gateway.refundsFail = false;
  gateway.disputesStatus = 200;
});

describe('🔴 a refund event is never handled as a payment', () => {
  it('a refund on a PENDING order credits nothing (the old path fulfilled it, because Cashfree still says PAID)', async () => {
    store.set('payment_transactions/ord_p', { userId: 'buyer', amountPaid: 102, balanceAdded: 100, platformFeeInr: 2, paymentStatus: 'PENDING', productType: 'wallet' });
    gateway.refunds = [{ order_id: 'ord_p', refund_amount: 102, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    // A body that ALSO names the order the payment way — still a refund.
    const res = await deliver({ ...refundEvent('ord_p'), data: { ...refundEvent('ord_p').data, order: { order_id: 'ord_p' } } });
    expect(res.statusCode).toBe(200);
    expect(store.get('user_token_wallets/buyer')).toBeUndefined(); // nothing credited
    expect(order('ord_p').paymentStatus).toBe('PENDING');
    expect(order('ord_p').refundedInr).toBe(102); // recorded for the credit to honour
    // The payment verifier (GET /pg/orders/{id}) was never asked.
    expect(getCalls.some((u) => /\/pg\/orders\/ord_p$/.test(u))).toBe(false);
  });

  it('a refund recorded before the credit is taken back in the SAME transaction as the credit', async () => {
    store.set('payment_transactions/ord_p', { userId: 'buyer', amountPaid: 102, balanceAdded: 100, platformFeeInr: 2, paymentStatus: 'PENDING', productType: 'wallet' });
    gateway.refunds = [{ order_id: 'ord_p', refund_amount: 102, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    await deliver(refundEvent('ord_p'));
    const r = await verifyPaymentInternal('ord_p'); // the reconcile sweep, later
    expect(r.success).toBe(true);
    expect(wallet().tokenBalance).toBe(0);
    expect(order('ord_p').clawbackTargetTokens).toBe(10_000);
    expect(lastRow().type).toBe('refund');
    // And it never runs twice.
    await deliver(refundEvent('ord_p'));
    expect(wallet().tokenBalance).toBe(0);
  });

  it('a forged signature changes nothing', async () => {
    creditedOrder('ord_f', 10_000);
    gateway.refunds = [{ order_id: 'ord_f', refund_amount: 102, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    const res = await deliver(refundEvent('ord_f'), { sign: false });
    expect(res.statusCode).toBe(401);
    expect(wallet().tokenBalance).toBe(10_000);
  });

  it('a payment event still fulfils exactly as before', async () => {
    store.set('payment_transactions/ord_ok', { userId: 'buyer', amountPaid: 102, balanceAdded: 100, platformFeeInr: 2, paymentStatus: 'PENDING', productType: 'wallet' });
    const res = await deliver({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: 'ord_ok' } } });
    expect(res.statusCode).toBe(200);
    expect(order('ord_ok').paymentStatus).toBe('SUCCESS');
    expect(wallet().tokenBalance).toBe(10_000);
    expect(getCalls.some((u) => u.endsWith('/refunds'))).toBe(false);
  });
});

describe('🔴 the clawback — proportional, idempotent, never below zero', () => {
  it('a full refund takes back exactly what the order credited, and leaves other money alone', async () => {
    creditedOrder('ord_1', 15_000);
    gateway.refunds = [{ order_id: 'ord_1', refund_amount: 102, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    const res = await deliver(refundEvent('ord_1'));
    expect(res.statusCode).toBe(200);
    expect(wallet().tokenBalance).toBe(5_000);
    expect(wallet().remaining_balance).toBeCloseTo(50, 6);
    expect(lastRow()).toMatchObject({ type: 'refund', amountCoinsOrTokens: -10_000, reversalRef: 'ord_1' });
    expect(String(lastRow().description)).toMatch(/^Refund: ₹102\.00 returned/);
  });

  it('a partial refund takes back the same fraction', async () => {
    creditedOrder('ord_2', 15_000);
    gateway.refunds = [{ order_id: 'ord_2', refund_amount: 51, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    await deliver(refundEvent('ord_2', 51));
    expect(wallet().tokenBalance).toBe(10_000);
    expect(order('ord_2').clawbackTargetTokens).toBe(5_000);
  });

  it('a retried webhook debits nothing more; a SECOND refund debits only its own share', async () => {
    creditedOrder('ord_3', 15_000);
    gateway.refunds = [{ order_id: 'ord_3', refund_amount: 51, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    await deliver(refundEvent('ord_3', 51));
    await deliver(refundEvent('ord_3', 51));
    await deliver(refundEvent('ord_3', 51));
    expect(wallet().tokenBalance).toBe(10_000);
    gateway.refunds.push({ order_id: 'ord_3', refund_amount: 25.5, refund_status: 'SUCCESS', cf_refund_id: 'r2' });
    await deliver(refundEvent('ord_3', 25.5));
    expect(wallet().tokenBalance).toBe(7_500);
    expect(wallet().walletLedger.filter((r: Doc) => r.type === 'refund')).toHaveLength(2);
  });

  it('the wallet goes down to ZERO and never below; the part already spent is recorded, not owed', async () => {
    creditedOrder('ord_4', 3_000);
    gateway.refunds = [{ order_id: 'ord_4', refund_amount: 102, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    await deliver(refundEvent('ord_4'));
    expect(wallet().tokenBalance).toBe(0);
    expect(wallet().remaining_balance).toBe(0);
    expect(order('ord_4').clawedBackTokens).toBe(3_000);
    expect(order('ord_4').clawbackShortfallTokens).toBe(7_000);
    expect(String(lastRow().description)).toMatch(/already been used, and are not charged to you/);
    // A later recharge is never taken by a retry of the same refund.
    wallet().tokenBalance = 20_000;
    await deliver(refundEvent('ord_4'));
    expect(wallet().tokenBalance).toBe(20_000);
  });

  it('a wallet already in overdraft is neither deepened nor lifted', async () => {
    creditedOrder('ord_5', -500);
    gateway.refunds = [{ order_id: 'ord_5', refund_amount: 102, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    await deliver(refundEvent('ord_5'));
    expect(wallet().tokenBalance).toBe(-500);
    expect(order('ord_5').clawbackShortfallTokens).toBe(10_000);
  });

  it('🔴 the BODY amount is ignored — only what Cashfree\'s own API reports is used', async () => {
    creditedOrder('ord_6', 15_000);
    gateway.refunds = [{ order_id: 'ord_6', refund_amount: 10.2, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    await deliver(refundEvent('ord_6', 102)); // the body claims a full refund
    expect(wallet().tokenBalance).toBe(14_000); // 10% of 10,000 taken
  });

  it('a refund the API still calls PENDING takes nothing, whatever the body says', async () => {
    creditedOrder('ord_7', 15_000);
    gateway.refunds = [{ order_id: 'ord_7', refund_amount: 102, refund_status: 'PENDING', cf_refund_id: 'r1' }];
    await deliver(refundEvent('ord_7', 102, 'SUCCESS'));
    expect(wallet().tokenBalance).toBe(15_000);
  });

  it('an unreadable refunds listing is retried (non-2xx), never acknowledged as nothing', async () => {
    creditedOrder('ord_8', 15_000);
    gateway.refundsFail = true;
    const res = await deliver(refundEvent('ord_8'));
    expect(res.statusCode).toBe(502);
    expect(wallet().tokenBalance).toBe(15_000);
  });
});

describe('chargebacks', () => {
  it('a LOST chargeback takes the tokens back; an open one does not', async () => {
    creditedOrder('ord_c', 15_000);
    gateway.disputes = [{ dispute_id: 'd1', dispute_amount: 102, dispute_status: 'CHARGEBACK_CREATED', order_details: { order_id: 'ord_c' } }];
    await deliver(disputeEvent('ord_c', 'DISPUTE_CREATED'));
    expect(wallet().tokenBalance).toBe(15_000);
    gateway.disputes[0].dispute_status = 'CHARGEBACK_MERCHANT_LOST';
    await deliver(disputeEvent('ord_c'));
    expect(wallet().tokenBalance).toBe(5_000);
    expect(String(lastRow().description)).toMatch(/^Chargeback:/);
  });

  it('a dispute the merchant WON takes nothing', async () => {
    creditedOrder('ord_w', 15_000);
    gateway.disputes = [{ dispute_id: 'd1', dispute_amount: 102, dispute_status: 'DISPUTE_MERCHANT_WON', order_details: { order_id: 'ord_w' } }];
    await deliver(disputeEvent('ord_w'));
    expect(wallet().tokenBalance).toBe(15_000);
  });

  it('a refund AND a lost chargeback on the same money never take more than the order credited', async () => {
    creditedOrder('ord_rc', 30_000);
    gateway.refunds = [{ order_id: 'ord_rc', refund_amount: 102, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    gateway.disputes = [{ dispute_id: 'd1', dispute_amount: 102, dispute_status: 'DISPUTE_MERCHANT_LOST', order_details: { order_id: 'ord_rc' } }];
    await deliver(refundEvent('ord_rc'));
    await deliver(disputeEvent('ord_rc'));
    expect(wallet().tokenBalance).toBe(20_000);
  });
});

describe('gift-code orders', () => {
  function giftOrder(id: string, status: GiftCodeRecord['status'], redeemer?: string) {
    store.set(`payment_transactions/${id}`, {
      userId: 'buyer', amountPaid: 510, balanceAdded: 0, platformFeeInr: 10, giftFaceInr: 500,
      paymentStatus: 'SUCCESS', paymentProvider: 'CASHFREE', productType: 'gift_code', giftCode: `NBGIFT-${id}`,
    });
    store.set(`gift_codes/NBGIFT-${id}`, { code: `NBGIFT-${id}`, buyerUid: 'buyer', faceInr: 500, paidInr: 510, feeInr: 10, orderId: id, status, createdAt: 'x', ...(redeemer ? { redeemedBy: redeemer } : {}) });
    store.set('user_token_wallets/buyer', { userId: 'buyer', tokenBalance: 20_000, remaining_balance: 200, walletLedger: [] });
    store.set('user_token_wallets/friend', { userId: 'friend', tokenBalance: 50_000, remaining_balance: 500, walletLedger: [] });
  }

  it('an UNUSED code is voided by a full refund, and nobody\'s wallet moves', async () => {
    giftOrder('g1', 'unused');
    gateway.refunds = [{ order_id: 'g1', refund_amount: 510, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    await deliver(refundEvent('g1', 510));
    expect(store.get('gift_codes/NBGIFT-g1')!.status).toBe('voided');
    expect(wallet('buyer').tokenBalance).toBe(20_000);
    expect(decideGiftRedemption(store.get('gift_codes/NBGIFT-g1') as GiftCodeRecord, 'friend')).toMatchObject({ ok: false, reason: 'voided' });
  });

  it('an UNUSED code loses only the refunded share on a partial refund', async () => {
    giftOrder('g2', 'unused');
    gateway.refunds = [{ order_id: 'g2', refund_amount: 255, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    await deliver(refundEvent('g2', 255));
    expect(store.get('gift_codes/NBGIFT-g2')).toMatchObject({ status: 'unused', faceInr: 250, faceBeforeRefundInr: 500 });
  });

  it('a gift order refunded BEFORE its code was minted never hands out a live code', async () => {
    store.set('payment_transactions/g0', {
      userId: 'buyer', amountPaid: 510, balanceAdded: 0, platformFeeInr: 10, giftFaceInr: 500,
      paymentStatus: 'PENDING', paymentProvider: 'CASHFREE', productType: 'gift_code',
    });
    gateway.order = { order_status: 'PAID', order_amount: 510, cf_order_id: 'cf_g0' };
    gateway.refunds = [{ order_id: 'g0', refund_amount: 510, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    await deliver(refundEvent('g0', 510));
    const r = await verifyPaymentInternal('g0'); // the buyer's own check, later
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/refunded/);
    const minted = [...store.entries()].find(([k, v]) => k.startsWith('gift_codes/NBGIFT-') && v.orderId === 'g0');
    expect(minted?.[1].status).toBe('voided');
  });

  it('a REDEEMED code: the recipient is never touched; the buyer gives the value back, down to zero', async () => {
    giftOrder('g3', 'redeemed', 'friend');
    gateway.refunds = [{ order_id: 'g3', refund_amount: 510, refund_status: 'SUCCESS', cf_refund_id: 'r1' }];
    await deliver(refundEvent('g3', 510));
    expect(wallet('friend').tokenBalance).toBe(50_000);
    expect(wallet('buyer').tokenBalance).toBe(0);
    expect(order('g3').clawedBackTokens).toBe(20_000);
    expect(order('g3').clawbackShortfallTokens).toBe(30_000);
    expect(String(lastRow('buyer').description)).toMatch(/gift code purchase/);
  });
});

describe('the pure rules', () => {
  it('classifies by event family, defensively', () => {
    expect(classifyCashfreeWebhook({ type: 'PAYMENT_SUCCESS_WEBHOOK' })).toBe('payment');
    expect(classifyCashfreeWebhook({ type: 'REFUND_STATUS_WEBHOOK' })).toBe('refund');
    expect(classifyCashfreeWebhook({ type: 'AUTO_REFUND_STATUS_WEBHOOK' })).toBe('refund');
    expect(classifyCashfreeWebhook({ type: 'DISPUTE_UPDATED' })).toBe('dispute');
    expect(classifyCashfreeWebhook({ data: { refund: {} } })).toBe('refund');
    expect(classifyCashfreeWebhook({ data: { dispute: {} } })).toBe('dispute');
    expect(classifyCashfreeWebhook({})).toBe('payment');
  });

  it('finds the order id wherever the event family puts it', () => {
    expect(cashfreeWebhookOrderId({ data: { order: { order_id: 'a' } } })).toBe('a');
    expect(cashfreeWebhookOrderId({ data: { refund: { order_id: 'b' } } })).toBe('b');
    expect(cashfreeWebhookOrderId({ data: { order_details: { order_id: 'c' } } })).toBe('c');
    expect(cashfreeWebhookOrderId({ data: {} })).toBeNull();
    expect(cashfreeWebhookOrderId({ data: { order: { order_id: 'x'.repeat(200) } } })).toBeNull();
  });

  it('counts only SUCCESS refunds and LOST/ACCEPTED disputes for THIS order, once each', () => {
    expect(sumSuccessfulRefundsInr([
      { order_id: 'o', refund_amount: 10, refund_status: 'SUCCESS', cf_refund_id: '1' },
      { order_id: 'o', refund_amount: 10, refund_status: 'SUCCESS', cf_refund_id: '1' },
      { order_id: 'o', refund_amount: 5, refund_status: 'PENDING', cf_refund_id: '2' },
      { order_id: 'other', refund_amount: 99, refund_status: 'SUCCESS', cf_refund_id: '3' },
    ], 'o')).toBe(10);
    expect(sumSuccessfulRefundsInr({ refunds: [{ refund_amount: '7.5', refund_status: 'success' }] }, 'o')).toBe(7.5);
    expect(sumSuccessfulRefundsInr(null, 'o')).toBe(0);
    expect(isLostDisputeStatus('PRE_ARBITRATION_MERCHANT_LOST')).toBe(true);
    expect(isLostDisputeStatus('CHARGEBACK_MERCHANT_ACCEPTED')).toBe(true);
    expect(isLostDisputeStatus('DISPUTE_MERCHANT_WON')).toBe(false);
    expect(isLostDisputeStatus('DISPUTE_UNDER_REVIEW')).toBe(false);
    expect(sumLostDisputesInr([{ dispute_id: 'd', dispute_amount: 4, dispute_status: 'DISPUTE_MERCHANT_LOST', order_details: { order_id: 'x' } }], 'o')).toBe(0);
  });

  it('the target is proportional and capped; the delta is never negative', () => {
    expect(clawbackTargetTokens(10_000, 102, 51)).toBe(5_000);
    expect(clawbackTargetTokens(10_000, 102, 500)).toBe(10_000);
    expect(clawbackTargetTokens(10_000, 0, 51)).toBe(0);
    expect(clawbackDeltaTokens(5_000, 7_000)).toBe(0);
    expect(clawbackDeltaTokens(5_000, undefined)).toBe(5_000);
  });

  it('the statement still balances after a clawback (opening + Σ rows = balance)', () => {
    const w = { tokenBalance: 10_000, remaining_balance: 100, walletLedger: [{ type: 'purchase', amountCoinsOrTokens: 10_000 }] };
    const out = computeClawedBackWallet(w, { tokens: 4_000, reversedInr: 40, kind: 'refund', reversalRef: 'o' }, 'now');
    expect(buildWalletStatement(out.wallet).verdict).toBe('balanced');
    expect(out.wallet.tokenBalance).toBe(6_000);
  });
});

describe('the admin\'s purchase ledger reports refunds honestly', () => {
  it('a refunded row carries its refunded ₹ and the summary totals it, store rows still flagged', () => {
    const row = purchaseRow('ord_x', { userId: 'u', amountPaid: 102, paymentStatus: 'SUCCESS', paymentProvider: 'CASHFREE', refundedInr: 51 });
    expect(row.refundedInr).toBe(51);
    const s = summarisePurchases([row]);
    expect(s.refundedInr).toBe(51);
    // CHANGED 2026-10-06 (Q-690): Google Play is tracked by its daily voided-purchases check; Apple is not.
    expect(s.refundTracked).toBe('web-and-google-play');
  });
});
