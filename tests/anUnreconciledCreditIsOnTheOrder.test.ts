// Q-1135 — WHEN THE PAID-VS-RECORDED CHECK COULD NOT RUN, THE ORDER ITSELF SAYS SO.
//
// Q-890 made the un-reconcilable credit LOUD and credited our own recorded figure, which is the right
// call: refusing would strand a customer who really paid (the asymmetry is held in
// `theAmountCheckCannotBeSkipped.test.ts` so nobody "completes" it into a symmetric rule). What it left
// behind was a fact that lived ONLY in a `console.error`. Logs roll, nobody greps them during a support
// call, and the admin Revenue page cannot show what it cannot read — so the one credit that was never
// reconciled looked, forever after, exactly like the thousands that were.
//
// These tests run the REAL `verifyPaymentInternal` against an in-memory Firestore (the harness from
// `aPaidOrderIsNeverLeftUncredited.test.ts`, which commits a transaction all-or-nothing the way
// Firestore does), so what they assert is the stored document — not a restatement of the rule.
//
// The three properties that actually matter, and why each is here:
//   1. THE CREDIT STILL HAPPENS. This fix must not turn a silent un-reconciled credit into a refused
//      one. That would be fixing a reporting gap by stranding a payer.
//   2. THE FACT IS IN THE SAME TRANSACTION. Written as a second update it could land while the credit
//      rolled back, or roll back while the credit landed — a record that lies either way. Q-613 exists
//      to keep that one transaction whole.
//   3. EVERY SUCCESS FLIP CARRIES IT. The wallet credit and the pass/gift claim are two different
//      `tx.update`s in the same file, reading `amountPaid` from the same stored record, so both can be
//      un-reconcilable. Patching one and calling it done is this repo's most expensive habit (autopsy
//      a38c6fef: the instance fixed, the sibling never hunted, the same bug back two months later).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

type Doc = Record<string, any>;
const store = new Map<string, Doc>();
let failNextWalletWrite = false;

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
    runTransaction: async (_db: unknown, body: (tx: any) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (ref: { col: string; id: string }) => snap(ref),
        update: (ref: { col: string; id: string }, patch: Doc) => writes.push(() => {
          // Firestore REJECTS an `undefined` field value. The whole trigger for this patch is that the
          // recorded amount was junk, so the harness must enforce that rule or the test would pass on a
          // write the real database would refuse — and a refused write here rolls the credit back with it.
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) throw new Error(`Firestore would reject undefined field "${k}"`);
          }
          store.set(key(ref), { ...(store.get(key(ref)) ?? {}), ...patch });
        }),
        set: (ref: { col: string; id: string }, data: Doc) => writes.push(() => {
          if (ref.col === 'user_token_wallets' && failNextWalletWrite) { failNextWalletWrite = false; throw new Error('process died here'); }
          store.set(key(ref), structuredClone(data));
        }),
      };
      const out = await body(tx);
      const before = new Map(store);
      try { for (const w of writes) w(); } catch (e) { store.clear(); for (const [k, v] of before) store.set(k, v); throw e; }
      return out;
    },
  };
});

vi.mock('../src/server/lib/giftCodeStore', () => ({
  mintCodeForOrder: async (_db: unknown, o: { orderId: string }) => `NBGIFT-${o.orderId}`,
}));

// The gateway says PAID for ₹100. Only the ORDER's own recorded amount varies below — which is exactly
// the shape of the defect: our record is unreadable, the provider's figure is fine.
vi.mock('axios', () => ({
  default: { get: vi.fn(async () => ({ data: { order_status: 'PAID', order_amount: 100, cf_order_id: 'cf_1' } })) },
}));

process.env.CASHFREE_CLIENT_ID = 'live_client_id_for_tests';
process.env.CASHFREE_CLIENT_SECRET = 'live_client_secret_for_tests';
process.env.CASHFREE_ENV = 'production';

import { verifyPaymentInternal } from '../src/server/lib/payments';
import {
  RECONCILE_FIELDS, unreconciledCreditPatch, isUnreconciledCredit, unreconciledPatchIsStorable,
} from '../src/server/lib/paymentReconciliation';
import { REVERSAL_FIELDS } from '../src/server/lib/paymentReversal';
import { purchaseRow, summarisePurchases } from '../src/server/lib/purchaseLedger';

beforeEach(() => { store.clear(); failNextWalletWrite = false; });

const order = (id: string, extra: Doc = {}) =>
  store.set(`payment_transactions/${id}`, { userId: 'buyer', amountPaid: 100, balanceAdded: 100, paymentStatus: 'PENDING', ...extra });
const saved = (id: string) => store.get(`payment_transactions/${id}`)!;

describe('an un-reconciled credit is recorded on the order, not only in a log line', () => {
  it('a wallet top-up with an unreadable recorded amount is SETTLED and marked', async () => {
    order('ord_legacy', { amountPaid: 'legacy' });
    const r = await verifyPaymentInternal('ord_legacy');

    // 1. the order is settled rather than refused — this fix does not strand a payer
    expect(r.success).toBe(true);
    expect(saved('ord_legacy').paymentStatus).toBe('SUCCESS');
    // ⚠️ DELIBERATELY NOT ASSERTED HERE: how many tokens that credit put in the wallet.
    // Measured while writing this test: ZERO, while the ₹ view added `balanceAdded` in full — the
    // wallet's two halves move apart. That is a real defect with its own row, and pinning either
    // number here would encode it as a requirement, which is how a fix gets blocked by its own test
    // (three times in this repo already). This file asserts only what Q-1135 is about: that the fact
    // is recorded on the order, inside the one transaction that settles it.

    // 2. and the order now says the check could not run
    expect(saved('ord_legacy')[RECONCILE_FIELDS.unreconciledCredit]).toBe(true);
    expect(saved('ord_legacy')[RECONCILE_FIELDS.unreconciledReason]).toBe('recorded-amount-unreadable');
    expect(saved('ord_legacy')[RECONCILE_FIELDS.unreconciledProviderInr]).toBe(100);
    expect(saved('ord_legacy')[RECONCILE_FIELDS.unreconciledRecordedSeen]).toBe('legacy');
    expect(String(saved('ord_legacy')[RECONCILE_FIELDS.unreconciledAt])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('a healthy order carries none of it — the marker means something', async () => {
    order('ord_ok');
    await verifyPaymentInternal('ord_ok');
    expect(saved('ord_ok').paymentStatus).toBe('SUCCESS');
    expect(isUnreconciledCredit(saved('ord_ok'))).toBe(false);
    for (const f of Object.values(RECONCILE_FIELDS)) expect(saved('ord_ok')[f]).toBeUndefined();
  });

  it('an ABSENT recorded amount is marked too, and the write Firestore would reject never happens', async () => {
    // `JSON.stringify(undefined)` is `undefined`, not a string — writing that into the money transaction
    // would throw and roll the credit back. The harness enforces Firestore's rule, so this test is the
    // proof that the patch is built with `String()` and not with `JSON.stringify`.
    order('ord_absent', { amountPaid: undefined });
    const r = await verifyPaymentInternal('ord_absent');
    expect(r.success).toBe(true);
    expect(saved('ord_absent')[RECONCILE_FIELDS.unreconciledRecordedSeen]).toBe('undefined');
    expect(saved('ord_absent').paymentStatus).toBe('SUCCESS');
  });

  it('THE SAME TRANSACTION: if the credit rolls back, the mark rolls back with it', async () => {
    order('ord_roll', { amountPaid: 'legacy' });
    failNextWalletWrite = true;
    const first = await verifyPaymentInternal('ord_roll');

    expect(first.success).toBe(false);
    expect(saved('ord_roll').paymentStatus).toBe('PENDING');          // not claimed
    expect(isUnreconciledCredit(saved('ord_roll'))).toBe(false);       // and not marked
    expect(store.get('user_token_wallets/buyer')).toBeUndefined();     // nothing landed at all

    const retry = await verifyPaymentInternal('ord_roll');             // the webhook's retry finishes it
    expect(retry.success).toBe(true);
    expect(saved('ord_roll').paymentStatus).toBe('SUCCESS');
    expect(isUnreconciledCredit(saved('ord_roll'))).toBe(true);
  });

  it('THE SIBLING: a gift order goes through the OTHER success flip, and is marked there too', async () => {
    // Wallet top-ups claim inside the credit transaction; PASS and GIFT products claim in a separate
    // `tx.update` further down the same function. Both read `amountPaid` from the stored record, so
    // both can be un-reconcilable — and only one of them was obvious.
    order('ord_gift', { amountPaid: NaN, productType: 'gift_code', giftFaceInr: 500, balanceAdded: 0 });
    const r = await verifyPaymentInternal('ord_gift');

    expect(r.success).toBe(true);
    expect(saved('ord_gift').paymentStatus).toBe('SUCCESS');
    expect(isUnreconciledCredit(saved('ord_gift'))).toBe(true);
    expect(saved('ord_gift')[RECONCILE_FIELDS.unreconciledRecordedSeen]).toBe('NaN');
  });
});

describe('the patch is storable whatever junk it is handed', () => {
  it('no value is ever undefined or a non-finite number', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const hostile: unknown[] = [
      undefined, null, NaN, Infinity, -Infinity, '', '   ', 'legacy', 0, -1, {}, [], circular,
      () => 1, Symbol('amount'), true, 10n,
    ];
    for (const v of hostile) {
      const patch = unreconciledCreditPatch(100, v, '2026-10-20T06:00:00.000Z');
      expect(unreconciledPatchIsStorable(patch as unknown as Record<string, unknown>), `storable for ${String(v)}`).toBe(true);
      expect(typeof patch.unreconciledRecordedSeen).toBe('string');
      expect(patch.unreconciledRecordedSeen.length).toBeLessThanOrEqual(200);
    }
  });

  it('an unreadable PROVIDER amount is omitted, never invented as 0', () => {
    // A `0` here would read as "the provider charged nothing" — a lie about money, in the very record
    // that exists because a money fact was unreadable.
    for (const bad of [undefined, null, NaN, 'abc', {}]) {
      const patch = unreconciledCreditPatch(bad, 'legacy', '2026-10-20T06:00:00.000Z');
      expect(RECONCILE_FIELDS.unreconciledProviderInr in patch).toBe(false);
      expect(unreconciledPatchIsStorable(patch as unknown as Record<string, unknown>)).toBe(true);
    }
    expect(unreconciledCreditPatch(499.005, 'x', 'now').unreconciledProviderInr).toBe(499.01);
  });

  it('an empty timestamp never becomes undefined on the document', () => {
    for (const bad of ['', undefined as unknown as string, null as unknown as string]) {
      const patch = unreconciledCreditPatch(100, 'legacy', bad);
      expect(typeof patch.unreconciledAt).toBe('string');
      expect(patch.unreconciledAt).not.toBe('');
    }
  });

  it('its field names collide with nothing already written on the order', () => {
    const mine = new Set<string>(Object.values(RECONCILE_FIELDS));
    for (const other of [...Object.values(REVERSAL_FIELDS), 'paymentStatus', 'paymentReference', 'amountPaid', 'balanceAdded', 'giftCode', 'expiredAt', 'providerOrderStatus']) {
      expect(mine.has(other), `${other} must not be overwritten by this patch`).toBe(false);
    }
  });

  it('the marker is strict: only a real `true` counts', () => {
    expect(isUnreconciledCredit(null)).toBe(false);
    expect(isUnreconciledCredit(undefined)).toBe(false);
    expect(isUnreconciledCredit({})).toBe(false);
    for (const v of ['true', 1, 'yes', {}]) expect(isUnreconciledCredit({ unreconciledCredit: v })).toBe(false);
    expect(isUnreconciledCredit({ unreconciledCredit: true })).toBe(true);
  });
});

describe('THE CLASS: every SUCCESS flip in the payments file carries the mark', () => {
  const CODE = stripCodeComments(readFileSync(join(process.cwd(), 'src/server/lib/payments.ts'), 'utf8'));

  it('each `tx.update` that flips SUCCESS spreads the un-reconciled patch', () => {
    const flips = CODE.split('\n').filter((l) => l.includes('tx.update(') && l.includes("paymentStatus: 'SUCCESS'"));
    // A census that matches nothing passes vacuously — the trap that cost this session a wrong green
    // once already. Assert the census FOUND the sites before asserting anything about them.
    expect(flips.length, 'the census found no SUCCESS flip — the pattern moved, so this guard is blind').toBeGreaterThanOrEqual(2);
    for (const line of flips) {
      expect(line, 'a SUCCESS flip that does not carry the un-reconciled patch leaves that order silent').toContain('unreconciled');
    }
  });

  it('the log no longer claims a credit that does not happen', () => {
    // It said "Crediting the server-recorded amount". Measured: the token credit is ZERO, because it
    // derives from the same unreadable `amountPaid`. Fixing the code is a money decision with its own
    // row; fixing what the system SAYS about itself is the fifth absolute rule's step 5, and is here.
    expect(CODE, 'the old sentence described a credit the code does not make').not.toContain('Crediting the server-recorded amount');
    expect(CODE).toContain('token credit of ZERO');
    expect(CODE).toContain('needs checking by hand');
  });

  it('and it is never written as a second update of its own', () => {
    // A standalone write could land while the credit rolled back, or roll back while it landed.
    for (const line of CODE.split('\n')) {
      if (!line.includes('unreconciled')) continue;
      if (!line.includes('.update(') && !line.includes('updateDoc(')) continue;
      expect(line, 'the mark must ride the SUCCESS flip, not a write of its own').toContain("paymentStatus: 'SUCCESS'");
    }
  });
});

describe('the one reading of payment_transactions carries the fact to the admin', () => {
  const row = (id: string, tx: Doc) => purchaseRow(id, tx);
  const base = { userId: 'u1', createdAt: '2026-10-20T06:00:00.000Z', paymentStatus: 'SUCCESS', paymentProvider: 'CASHFREE', amountPaid: 100, balanceAdded: 100 };

  it('a marked order reads as unreconciled; a normal one does not', () => {
    expect(row('a', { ...base, unreconciledCredit: true }).unreconciled).toBe(true);
    expect(row('b', base).unreconciled).toBe(false);
  });

  it('the summary counts them, so a count can be shown instead of a silence', () => {
    const rows = [row('a', { ...base, unreconciledCredit: true }), row('b', base), row('c', { ...base, unreconciledCredit: true })];
    expect(summarisePurchases(rows).unreconciledRows).toBe(2);
    expect(summarisePurchases([row('b', base)]).unreconciledRows).toBe(0);
    // And it does not disturb what that summary already reported.
    expect(summarisePurchases(rows).revenueRows).toBe(3);
  });
});
