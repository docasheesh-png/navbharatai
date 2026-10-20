// Q-1226: exercise the real settlement and refund paths with a gateway-confirmed amount.
// The fake database serializes commits and rolls back all writes on failure. No live gateway/DB.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Doc = Record<string, any>;
const store = new Map<string, Doc>();
let failWallet = false;
let beforeTransaction: (() => void) | null = null;
let transactionTail = Promise.resolve();
let gatewayAmount: unknown = 100;
const mintCalls: Doc[] = [];
const passGrants: unknown[][] = [];

vi.mock('../src/server/lib/serverDb', () => {
  const key = (r: { col: string; id: string }) => `${r.col}/${r.id}`;
  const snap = (r: { col: string; id: string }) => {
    const d = store.get(key(r));
    return { exists: () => d !== undefined, data: () => d === undefined ? undefined : structuredClone(d) };
  };
  return {
    getServerDb: () => ({}),
    doc: (_: unknown, col: string, id: string) => ({ col, id }),
    getDoc: async (r: any) => snap(r),
    updateDoc: async (r: any, patch: Doc) => store.set(key(r), { ...store.get(key(r)), ...patch }),
    runTransaction: async (_: unknown, body: (t: any) => Promise<any>) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        const mutate = beforeTransaction;
        beforeTransaction = null;
        mutate?.();
        const writes: Array<() => void> = [];
        const result = await body({
          get: async (r: any) => snap(r),
          update: (r: any, patch: Doc) => writes.push(() => {
            expect(Object.values(patch)).not.toContain(undefined);
            store.set(key(r), { ...store.get(key(r)), ...structuredClone(patch) });
          }),
          set: (r: any, data: Doc) => writes.push(() => {
            if (failWallet && r.col === 'user_token_wallets') { failWallet = false; throw new Error('injected commit failure'); }
            store.set(key(r), structuredClone(data));
          }),
        });
        const before = new Map(store);
        try { for (const write of writes) write(); }
        catch (e) { store.clear(); for (const [k, v] of before) store.set(k, v); throw e; }
        return result;
      } finally { release(); }
    },
  };
});
vi.mock('axios', () => ({ default: { get: vi.fn(async () => ({ data: { order_status: 'PAID', order_amount: gatewayAmount, cf_order_id: 'cf_test' } })) } }));
vi.mock('../src/server/lib/giftCodeStore', () => ({
  mintCodeForOrder: async (_: unknown, o: Doc) => {
    mintCalls.push(o);
    const code = `NBGIFT-${o.orderId}`;
    store.set(`gift_codes/${code}`, { status: 'unused', faceInr: o.faceInr });
    store.set(`gift_codes/order_${o.orderId}`, { code });
    return code;
  },
}));
vi.mock('../src/server/professionals/ProfessionalPassStore', () => ({ professionalPassStore: { grant: async (...args: unknown[]) => { passGrants.push(args); return '2026-11-20'; } } }));
process.env.CASHFREE_CLIENT_ID = 'live_client_id_for_tests';
process.env.CASHFREE_CLIENT_SECRET = 'live_client_secret_for_tests';
process.env.CASHFREE_ENV = 'production';

import { computeCreditedWallet, verifyPaymentInternal, TOKENS_PER_RUPEE } from '../src/server/lib/payments';
import { applyOrderReversal } from '../src/server/lib/paymentReversalStore';
import { splitPaymentAtPct } from '../src/lib/platformFee';
import { orderCreditedTokens } from '../src/server/lib/orderCredit';
import { purchaseRow } from '../src/server/lib/purchaseLedger';

const seed = (extra: Doc = {}) => store.set('payment_transactions/order', { userId: 'buyer', amountPaid: 100, balanceAdded: 100, paymentStatus: 'PENDING', paymentProvider: 'CASHFREE', ...extra });
const order = () => store.get('payment_transactions/order')!;
const wallet = () => store.get('user_token_wallets/buyer')!;
const refund = (amount: number) => applyOrderReversal({}, { orderId: 'order', refundedInr: amount, disputeLostInr: 0 });

beforeEach(() => {
  store.clear(); mintCalls.length = 0; passGrants.length = 0; failWallet = false; beforeTransaction = null;
  transactionTail = Promise.resolve(); gatewayAmount = 100;
});

describe('one verified amount settles every view and the durable order', () => {
  it.each([undefined, NaN, Infinity, 'legacy', null, '', ' ', true, [], {}])('repairs an unreadable record (%s) from the gateway, not balanceAdded', async (amountPaid) => {
    seed({ amountPaid, balanceAdded: 999999, platformFeeInr: 2 });
    const r = await verifyPaymentInternal('order');
    expect(r).toMatchObject({ success: true, data: { balanceAdded: 98, currentBalance: 98, tokenBalance: 9800 } });
    expect(wallet()).toMatchObject({ tokenBalance: 9800, remaining_balance: 98, total_balance: 98, totalTokensPurchased: 9800, totalMoneySpent: 100 });
    expect(wallet().walletLedger).toHaveLength(1);
    expect(wallet().walletLedger[0]).toMatchObject({ amountCoinsOrTokens: 9800, moneySpent: 100 });
    expect(order()).toMatchObject({ paymentStatus: 'SUCCESS', amountPaid: 100, balanceAdded: 98, unreconciledCredit: true, unreconciledProviderInr: 100 });
    expect(orderCreditedTokens(order() as any)).toBe(9800);
    expect(purchaseRow('order', order())).toMatchObject({ amountInr: 100, creditInr: 98, tokens: 9800 });
  });

  it('normalizes numeric legacy strings too, including the gateway string', async () => {
    gatewayAmount = '100'; seed({ amountPaid: '100', platformFeeInr: 2, balanceAdded: 999 });
    expect((await verifyPaymentInternal('order')).success).toBe(true);
    expect(order()).toMatchObject({ amountPaid: 100, balanceAdded: 98 });
    expect(wallet().tokenBalance).toBe(9800);
    expect(order().unreconciledCredit).toBeUndefined();
  });

  it.each([undefined, NaN, Infinity, null, '', ' ', true, [], {}, 'legacy', '0x64', 1e308, 0, -1])('refuses an invalid gateway amount (%s) without any writes', async (bad) => {
    gatewayAmount = bad; seed({ amountPaid: 'legacy' });
    expect(await verifyPaymentInternal('order')).toMatchObject({ success: false, settled: false });
    expect(order().paymentStatus).toBe('PENDING'); expect(wallet()).toBeUndefined();
  });

  it('rejects an actual mismatch and preserves the one-paisa tolerance', async () => {
    seed({ amountPaid: 101 });
    expect(await verifyPaymentInternal('order')).toMatchObject({ success: false, settled: true });
    expect(wallet()).toBeUndefined();
    seed({ amountPaid: 100.005 });
    expect((await verifyPaymentInternal('order')).success).toBe(true);
    expect(wallet().remaining_balance).toBe(100); expect(order().amountPaid).toBe(100);
  });

  it.each([{}, { platformFeeInr: 2 }, { platformFeeInr: 200 }])('uses the recorded fee, bounded by verified gross (%s)', async (fee) => {
    seed({ amountPaid: 'legacy', ...fee });
    await verifyPaymentInternal('order');
    const net = Math.max(0, 100 - (fee.platformFeeInr ?? 0));
    expect(wallet().remaining_balance).toBe(net); expect(wallet().tokenBalance).toBe(net * TOKENS_PER_RUPEE);
  });

  it('uses the transaction-fresh fee and refuses a transaction-fresh mismatch', async () => {
    seed(); beforeTransaction = () => seed({ amountPaid: 101 });
    expect(await verifyPaymentInternal('order')).toMatchObject({ success: false, settled: true }); expect(wallet()).toBeUndefined();
    seed(); beforeTransaction = () => seed({ amountPaid: 'legacy', platformFeeInr: 7 });
    expect((await verifyPaymentInternal('order')).data.balanceAdded).toBe(93);
    expect(order().unreconciledRecordedSeen).toBe('legacy');
  });

  it.each([{ userId: 'other' }, { productType: 'gift_code', giftFaceInr: 100 }])('refuses a changed target/product (%s)', async (change) => {
    seed(); beforeTransaction = () => seed(change);
    expect(await verifyPaymentInternal('order')).toMatchObject({ success: false, settled: false });
    expect(order().paymentStatus).toBe('PENDING'); expect(wallet()).toBeUndefined(); expect(mintCalls).toHaveLength(0);
  });

  it.each(['wallet', 'gift_code', 'professional_pass'])('settles a missing transaction-fresh %s order without a credit or entitlement', async (productType) => {
    seed({ productType }); beforeTransaction = () => { store.delete('payment_transactions/order'); };
    expect(await verifyPaymentInternal('order')).toMatchObject({ success: false, settled: true, error: 'Transaction record not found' });
    expect(wallet()).toBeUndefined(); expect(mintCalls).toHaveLength(0); expect(passGrants).toHaveLength(0);
  });

  it('rolls back normalization, marker and money together, then retries exactly once', async () => {
    seed({ amountPaid: 'legacy', balanceAdded: 999, platformFeeInr: 2 }); failWallet = true;
    expect(await verifyPaymentInternal('order')).toMatchObject({ success: false, settled: false });
    expect(order()).toMatchObject({ amountPaid: 'legacy', balanceAdded: 999, paymentStatus: 'PENDING' });
    expect(order().unreconciledCredit).toBeUndefined(); expect(wallet()).toBeUndefined();
    const responses = await Promise.all([verifyPaymentInternal('order'), verifyPaymentInternal('order'), verifyPaymentInternal('order')]);
    expect(responses.filter(r => r.data?.alreadyProcessed)).toHaveLength(2);
    expect(wallet().tokenBalance).toBe(9800); expect(wallet().walletLedger).toHaveLength(1);
    for (const r of responses) expect(r.data.balanceAdded).toBe(98);
    expect((await verifyPaymentInternal('order')).data.balanceAdded).toBe(98);
  });

  it('does not silently recredit historical SUCCESS rows', async () => {
    seed({ amountPaid: 'legacy', paymentStatus: 'SUCCESS' });
    expect((await verifyPaymentInternal('order')).data.alreadyProcessed).toBe(true);
    expect(order().amountPaid).toBe('legacy'); expect(wallet()).toBeUndefined();
  });
});

describe('the normalized basis is also the refund basis', () => {
  it.each([false, true])('handles a full refund before or after credit (before=%s)', async (before) => {
    seed({ amountPaid: 'legacy', platformFeeInr: 2 });
    if (before) expect((await refund(100)).status).toBe('recorded-before-credit');
    await verifyPaymentInternal('order');
    if (!before) await refund(100);
    expect(wallet()).toMatchObject({ tokenBalance: 0, remaining_balance: 0 });
    expect(order()).toMatchObject({ clawbackTargetTokens: 9800, clawedBackTokens: 9800 });
    const ledgerLength = wallet().walletLedger.length;
    await refund(100); await verifyPaymentInternal('order');
    expect(wallet().tokenBalance).toBe(0); expect(wallet().walletLedger).toHaveLength(ledgerLength);
  });

  it('settles a refund recorded after the initial order read from the transaction-fresh row', async () => {
    seed({ amountPaid: 'legacy', platformFeeInr: 2 });
    beforeTransaction = () => seed({ amountPaid: 'legacy', platformFeeInr: 2, refundedInr: 25 });
    await verifyPaymentInternal('order');
    expect(wallet()).toMatchObject({ tokenBalance: 7350, remaining_balance: 73.5 });
    expect(order()).toMatchObject({ amountPaid: 100, balanceAdded: 98, clawbackTargetTokens: 2450, clawedBackTokens: 2450 });
    await refund(25);
    expect(wallet()).toMatchObject({ tokenBalance: 7350, remaining_balance: 73.5 });
  });

  it('partial refund then chargeback removes only the tokens actually bought', async () => {
    seed({ amountPaid: undefined, platformFeeInr: 2 });
    await verifyPaymentInternal('order'); await refund(25);
    expect(wallet()).toMatchObject({ tokenBalance: 7350, remaining_balance: 73.5 });
    await applyOrderReversal({}, { orderId: 'order', refundedInr: 25, disputeLostInr: 75 });
    expect(wallet()).toMatchObject({ tokenBalance: 0, remaining_balance: 0 });
    expect(order().clawbackTargetTokens).toBe(9800);
  });

  it('keeps a gift entitlement separate and applies a recorded refund after minting', async () => {
    gatewayAmount = 510;
    seed({ productType: 'gift_code', giftFaceInr: 500, amountPaid: NaN, balanceAdded: 0, platformFeeInr: 10 });
    await refund(255);
    const r = await verifyPaymentInternal('order');
    expect(r).toMatchObject({ success: true, data: { paidInr: 510, giftFaceInr: 250 } });
    expect(mintCalls[0]).toMatchObject({ faceInr: 500, paidInr: 510, feeInr: 10 });
    expect(order()).toMatchObject({ amountPaid: 510, balanceAdded: 0, giftFaceInr: 500 });
    expect(wallet()).toBeUndefined();
    await verifyPaymentInternal('order'); expect(mintCalls).toHaveLength(1);
  });
});

describe('paid deltas never rewrite unrelated wallet history or gift semantics', () => {
  it.each([{}, { giftTokensRemaining: 5000 }, { giftTokensRemaining: 25000 }])('preserves gift field presence and value (%s)', (gift) => {
    const current = { tokenBalance: 6000, remaining_balance: 70, total_balance: 80, ...gift };
    const next = computeCreditedWallet(current, { userId: 'buyer', amountPaid: 100, balanceAdded: 999, platformFeeInr: 2 }, 'now').wallet;
    expect(next).toMatchObject({ tokenBalance: 15800, remaining_balance: 168, total_balance: 178 });
    expect(Object.hasOwn(next, 'giftTokensRemaining')).toBe(Object.hasOwn(current, 'giftTokensRemaining'));
    expect(next.giftTokensRemaining).toBe(current.giftTokensRemaining);
  });

  it('pays down overdraft by exactly the paid delta, without forgiving it', () => {
    const next = computeCreditedWallet({ tokenBalance: -20000, remaining_balance: -200 }, { userId: 'buyer', amountPaid: 100, balanceAdded: 100 }, 'now').wallet;
    expect(next).toMatchObject({ tokenBalance: -10000, remaining_balance: -100 });
  });

  it.each([undefined, NaN, Infinity, '100', -100])('unverified pure-helper input cannot move INR alone (%s)', (bad) => {
    const next = computeCreditedWallet({}, { userId: 'buyer', amountPaid: bad, balanceAdded: 100, platformFeeInr: 2 } as any, 'now').wallet;
    expect(next).toMatchObject({ tokenBalance: 0, remaining_balance: 0, total_balance: 0 });
  });
});


describe('healthy money rules and retired-product settlement remain intact', () => {
  it('retains 105,000 healthy paid/fee rounding cases', () => {
    let checked = 0;
    for (let p = 1; p <= 1500; p++) for (let f = 0; f < 70; f++) {
      const split = splitPaymentAtPct(p * 17.03, f * 20 / 69);
      const tx = { userId: 'buyer', amountPaid: split.paidInr, balanceAdded: split.creditInr, platformFeeInr: split.feeInr };
      const w = computeCreditedWallet({}, tx, 'now').wallet;
      if (w.remaining_balance !== split.creditInr || w.total_balance !== split.creditInr || w.tokenBalance !== Math.round(split.creditInr * TOKENS_PER_RUPEE)) {
        throw new Error(`Healthy rounding changed: ${JSON.stringify(tx)}`);
      }
      checked++;
    }
    expect(checked).toBe(105000);
  });

  it('honors a pending retired pass using the normalized paid amount, once', async () => {
    process.env.PROFESSIONAL_PASS_PRICE_INR = '99'; process.env.PROFESSIONAL_PASS_DAYS = '30';
    gatewayAmount = 198;
    seed({ amountPaid: 'legacy', productType: 'professional_pass', balanceAdded: 0 });
    const result = await verifyPaymentInternal('order');
    expect(result).toMatchObject({ success: true, data: { professionalPass: true, days: 60 } });
    expect(passGrants).toEqual([['buyer', 60, 'monthly']]);
    expect(order()).toMatchObject({ amountPaid: 198, balanceAdded: 0 }); expect(wallet()).toBeUndefined();
    await verifyPaymentInternal('order'); expect(passGrants).toHaveLength(1);
  });

  it('does not reinterpret store price as wallet credit or refund basis', async () => {
    seed({ amountPaid: 99, balanceAdded: 99, storePriceInr: 119, paymentProvider: 'GOOGLE_PLAY', paymentStatus: 'SUCCESS' });
    store.set('user_token_wallets/buyer', computeCreditedWallet({}, order() as any, 'now').wallet);
    expect(wallet()).toMatchObject({ tokenBalance: 9900, remaining_balance: 99 });
    await refund(119);
    expect(wallet()).toMatchObject({ tokenBalance: 0, remaining_balance: 0 });
  });
});
