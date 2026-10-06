// Q-690 (admin decision 2026-10-06) — a Google Play refund or chargeback takes back the tokens that pack
// bought, through a daily read of Play's Voided Purchases list with the purchase verifier's own service
// account.
//
// Before this, Q-614 (#3551) handled Cashfree only: a Play pack refunded a week after purchase kept every
// token it credited. These tests drive the REAL job (`runPlayVoidedPurchases`), the REAL Play client
// (`readGoogleVoidedPurchasesPage` + `googleAccessToken`, through storeVerify's own fetch seam) and the REAL
// reversal (`applyOrderReversal`) against an in-memory Firestore with all-or-nothing transactions and a
// fake androidpublisher API.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

type Doc = Record<string, any>;
const store = new Map<string, Doc>();
/** Order ids whose reversal transaction throws — a transient database failure on one purchase. */
const failTxFor = new Set<string>();

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
    setDoc: async (ref: { col: string; id: string }, data: Doc, opts?: { merge?: boolean }) => {
      store.set(key(ref), opts?.merge ? { ...(store.get(key(ref)) ?? {}), ...structuredClone(data) } : structuredClone(data));
    },
    updateDoc: async (ref: { col: string; id: string }, patch: Doc) => { store.set(key(ref), { ...(store.get(key(ref)) ?? {}), ...patch }); },
    collection: () => ({}), query: () => ({}), where: () => ({}), limit: () => ({}),
    getDocs: async () => ({ docs: [] }),
    runTransaction: async (_db: unknown, body: (tx: any) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (ref: { col: string; id: string }) => {
          if (writes.length) throw new Error('Firestore transactions require all reads before all writes');
          if (ref.col === 'payment_transactions' && failTxFor.has(ref.id)) throw new Error('deadline exceeded');
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

import { _setStoreFetchForTests } from '../src/server/lib/storeVerify';
import {
  runPlayVoidedPurchases, playRefundCheckView, voidedPurchaseDocIds,
  PLAY_VOIDED_JOB, PLAY_VOIDED_CURSOR_COLLECTION, PLAY_VOIDED_CURSOR_DOC, PLAY_VOIDED_OVERLAP_MS,
} from '../src/server/lib/playVoidedPurchases';
import { buildWalletStatement } from '../src/server/lib/walletStatement';
import { purchaseRow } from '../src/server/lib/purchaseLedger';
import { playRefundCheckText } from '../src/lib/playRefundCheckText';

// ── A real service-account key, so `googleAccessToken` really signs its JWT ──
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA_JSON = JSON.stringify({
  client_email: 'play-reader@example.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
});
const ENV = { GOOGLE_PLAY_PACKAGE_NAME: 'com.navbharat.ai', GOOGLE_PLAY_SA_JSON: SA_JSON } as NodeJS.ProcessEnv;

const NOW = Date.parse('2026-10-06T06:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

// ── The fake androidpublisher API. `play.voided` is the authoritative list, oldest first. ──
const play = {
  voided: [] as Doc[],
  pageSize: 1000,
  status: 200,
};
const calls: string[] = [];
_setStoreFetchForTests(async (url: string) => {
  calls.push(url);
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.test' }) };
  }
  if (url.includes('/purchases/voidedpurchases')) {
    if (play.status !== 200) return { ok: false, status: play.status, json: async () => ({ error: { code: play.status } }) };
    const u = new URL(url);
    const from = Number(u.searchParams.get('token') || 0);
    const size = Math.min(play.pageSize, Number(u.searchParams.get('maxResults') || 1000));
    const start = Number(u.searchParams.get('startTime'));
    const end = Number(u.searchParams.get('endTime'));
    const inWindow = play.voided.filter((v) => Number(v.voidedTimeMillis) >= start && Number(v.voidedTimeMillis) <= end);
    const page = inWindow.slice(from, from + size);
    const next = from + size < inWindow.length ? String(from + size) : undefined;
    return {
      ok: true, status: 200,
      json: async () => ({
        pageInfo: { totalResults: inWindow.length },
        ...(next ? { tokenPagination: { nextPageToken: next } } : {}),
        voidedPurchases: structuredClone(page),
      }),
    };
  }
  return { ok: false, status: 404, json: async () => ({}) };
});
afterAll(() => _setStoreFetchForTests(null));

const voidedCalls = () => calls.filter((u) => u.includes('/purchases/voidedpurchases'));

/** A credited ₹119 Play pack (₹99 of credit → 9,900 tokens), recorded exactly as `/api/payment/store/verify` writes it. */
function creditedPlayPack(reference: string, uid = 'buyer', tokensHeld = 9_900) {
  const id = `store_google_${reference}`;
  store.set(`payment_transactions/${id}`, {
    transactionId: id, userId: uid, amountPaid: 99, balanceAdded: 99, storePriceInr: 119, storeFeePct: 15,
    storeNetInr: 101.15, paymentProvider: 'GOOGLE_PLAY', paymentStatus: 'SUCCESS', paymentReference: reference,
    productId: 'nbai.tokens.99', createdAt: '2026-10-01T10:00:00.000Z',
  });
  store.set(`user_token_wallets/${uid}`, {
    userId: uid, tokenBalance: tokensHeld, remaining_balance: tokensHeld / 100, total_balance: tokensHeld / 100,
    totalTokensPurchased: 9_900, walletLedger: [{ type: 'purchase', amountCoinsOrTokens: tokensHeld }], giftTokensRemaining: 0,
  });
  return id;
}
const voided = (orderId: string, at: number, extra: Doc = {}) => ({
  kind: 'androidpublisher#voidedPurchase',
  purchaseToken: `tok_${orderId}`,
  orderId,
  purchaseTimeMillis: String(at - 3 * DAY),
  voidedTimeMillis: String(at),
  voidedSource: 0,
  voidedReason: 4,
  ...extra,
});
const wallet = (uid = 'buyer') => store.get(`user_token_wallets/${uid}`)!;
const order = (id: string) => store.get(`payment_transactions/${id}`)!;
const cursorDoc = () => store.get(`${PLAY_VOIDED_CURSOR_COLLECTION}/${PLAY_VOIDED_CURSOR_DOC}`);
const jobRun = () => store.get(`job_runs/${PLAY_VOIDED_JOB}`);

beforeEach(() => {
  store.clear();
  failTxFor.clear();
  calls.length = 0;
  play.voided = [];
  play.pageSize = 1000;
  play.status = 200;
});

describe('a voided Play purchase takes back what it bought — once', () => {
  it('a refunded pack loses all 9,900 tokens it credited, with the store reason on the order and the statement', async () => {
    const id = creditedPlayPack('GPA.1111-2222-3333-44444');
    play.voided = [voided('GPA.1111-2222-3333-44444', NOW - 2 * DAY)];

    const r = await runPlayVoidedPurchases({ nowMs: NOW, env: ENV });

    expect(r.status).toBe('ok');
    expect(r).toMatchObject({ seen: 1, reversed: 1, alreadyReversed: 0, unknown: 0, errors: 0, tokensTaken: 9_900 });
    expect(wallet().tokenBalance).toBe(0);
    // The FULL store price is the reversal — not the credit (₹99), which would take back only 83%.
    expect(order(id)).toMatchObject({ refundedInr: 119, clawbackTargetTokens: 9_900, clawedBackTokens: 9_900 });
    expect(order(id)).toMatchObject({ voidedReason: 4, voidedReasonLabel: 'accidental purchase', voidedSource: 0, voidedSourceLabel: 'requested by you' });
    const line = wallet().walletLedger.at(-1);
    expect(line.type).toBe('refund');
    expect(line.description).toContain('Refund (accidental purchase; requested by you)');
    expect(line.description).toContain('₹119.00 returned');
    expect(buildWalletStatement(wallet()).verdict).toBe('balanced');
    // The admin's purchase ledger now shows the refund on the Play row.
    expect(purchaseRow(id, order(id)).refundedInr).toBe(99);
  });

  it('a bank chargeback is recorded as a lost dispute and named "Chargeback" on the statement', async () => {
    const id = creditedPlayPack('GPA.cb');
    play.voided = [voided('GPA.cb', NOW - DAY, { voidedReason: 7, voidedSource: 2 })];
    const r = await runPlayVoidedPurchases({ nowMs: NOW, env: ENV });
    expect(r.reversed).toBe(1);
    expect(order(id)).toMatchObject({ disputeLostInr: 119, clawedBackTokens: 9_900, voidedSourceLabel: 'issued by the store' });
    expect(wallet().walletLedger.at(-1).description).toMatch(/^Chargeback \(chargeback; issued by the store\)/);
  });

  it('a pack already spent is taken down to zero and never below; the rest is recorded as shortfall', async () => {
    const id = creditedPlayPack('GPA.spent', 'buyer', 2_000);
    play.voided = [voided('GPA.spent', NOW - DAY)];
    await runPlayVoidedPurchases({ nowMs: NOW, env: ENV });
    expect(wallet().tokenBalance).toBe(0);
    expect(order(id)).toMatchObject({ clawedBackTokens: 2_000, clawbackShortfallTokens: 7_900 });
  });

  it('a purchase credited under its TOKEN (Play gave no order id) is found by the token', async () => {
    const v = voided('', NOW - DAY, { purchaseToken: 'tok_promo_only' });
    const id = creditedPlayPack('tok_promo_only');
    play.voided = [v];
    const r = await runPlayVoidedPurchases({ nowMs: NOW, env: ENV });
    expect(r.reversed).toBe(1);
    expect(order(id).clawedBackTokens).toBe(9_900);
    expect(voidedPurchaseDocIds({ orderId: 'GPA.9', purchaseToken: 'abc' })).toEqual(['store_google_GPA.9', 'store_google_abc']);
  });

  it('🔒 a second run is a no-op: nothing more is taken and no second statement line is written', async () => {
    const id = creditedPlayPack('GPA.twice', 'buyer', 20_000);
    play.voided = [voided('GPA.twice', NOW - DAY)];
    await runPlayVoidedPurchases({ nowMs: NOW, env: ENV });
    const afterFirst = structuredClone(wallet());
    expect(afterFirst.tokenBalance).toBe(20_000 - 9_900);

    // The next day re-reads the same void (the 24 h overlap) — and must take nothing.
    const r2 = await runPlayVoidedPurchases({ nowMs: NOW + DAY, env: ENV });
    expect(r2).toMatchObject({ seen: 1, reversed: 0, alreadyReversed: 1, errors: 0 });
    expect(wallet().tokenBalance).toBe(afterFirst.tokenBalance);
    expect(wallet().walletLedger.length).toBe(afterFirst.walletLedger.length);
    expect(order(id).clawedBackTokens).toBe(9_900);
  });
});

describe('the cursor', () => {
  it('🔒 advances only after a page is fully applied — a failure on one purchase keeps the whole page for the next run', async () => {
    const a = creditedPlayPack('GPA.a', 'ua');
    const b = creditedPlayPack('GPA.b', 'ub');
    play.voided = [voided('GPA.a', NOW - 3 * DAY), voided('GPA.b', NOW - 2 * DAY)];
    failTxFor.add(b);

    const r1 = await runPlayVoidedPurchases({ nowMs: NOW, env: ENV });
    expect(r1.status).toBe('partial');
    expect(r1).toMatchObject({ reversed: 1, errors: 1 });
    expect(cursorDoc()).toBeUndefined();
    expect(r1.cursorAfter).toBeNull();
    expect(order(a).clawedBackTokens).toBe(9_900);
    expect(order(b).clawedBackTokens).toBeUndefined();

    // The fault clears; the same page is re-read: A is a no-op, B is taken, and only now does the cursor move.
    failTxFor.clear();
    const r2 = await runPlayVoidedPurchases({ nowMs: NOW + 60_000, env: ENV });
    expect(r2.status).toBe('ok');
    expect(r2).toMatchObject({ reversed: 1, alreadyReversed: 1, errors: 0 });
    expect(order(b).clawedBackTokens).toBe(9_900);
    expect(wallet('ua').walletLedger.filter((l: Doc) => l.type === 'refund')).toHaveLength(1);
    expect(cursorDoc()?.lastVoidedTimeMillis).toBe(NOW - 2 * DAY);
  });

  it('the next run asks from the cursor minus the overlap, and never further back than Google allows', async () => {
    store.set(`${PLAY_VOIDED_CURSOR_COLLECTION}/${PLAY_VOIDED_CURSOR_DOC}`, { lastVoidedTimeMillis: NOW - 2 * DAY });
    await runPlayVoidedPurchases({ nowMs: NOW, env: ENV });
    const u = new URL(voidedCalls()[0]);
    expect(Number(u.searchParams.get('startTime'))).toBe(NOW - 2 * DAY - PLAY_VOIDED_OVERLAP_MS);
    expect(Number(u.searchParams.get('endTime'))).toBe(NOW);
    expect(u.searchParams.get('type')).toBe('0');

    // A cursor older than 30 days: clamped to the window, and the gap is said out loud.
    calls.length = 0;
    store.set(`${PLAY_VOIDED_CURSOR_COLLECTION}/${PLAY_VOIDED_CURSOR_DOC}`, { lastVoidedTimeMillis: NOW - 60 * DAY });
    const r = await runPlayVoidedPurchases({ nowMs: NOW, env: ENV });
    const start = Number(new URL(voidedCalls()[0]).searchParams.get('startTime'));
    expect(start).toBeGreaterThan(NOW - 30 * DAY);
    expect(r.gap).toBe(true);
    expect(r.reason).toMatch(/older than the 30 days/);
  });
});

describe('what is not ours, and what cannot run', () => {
  it('🔒 an unknown purchase is skipped and counted — never an error, never a write', async () => {
    creditedPlayPack('GPA.ours');
    play.voided = [voided('GPA.not-ours', NOW - 2 * DAY), voided('GPA.ours', NOW - DAY)];
    const before = store.size;
    const r = await runPlayVoidedPurchases({ nowMs: NOW, env: ENV });
    expect(r.status).toBe('ok');
    expect(r).toMatchObject({ seen: 2, reversed: 1, unknown: 1, errors: 0 });
    expect(r.unknownSamples).toEqual(['GPA.not-ours']);
    expect(store.has('payment_transactions/store_google_GPA.not-ours')).toBe(false);
    // Only the cursor and the job record are new documents.
    expect(store.size).toBe(before + 2);
    expect(cursorDoc()?.lastVoidedTimeMillis).toBe(NOW - DAY);
  });

  it('a row of another rail under a matching id is not touched', async () => {
    store.set('payment_transactions/store_google_GPA.web', { userId: 'u', amountPaid: 99, paymentStatus: 'SUCCESS', paymentProvider: 'CASHFREE' });
    play.voided = [voided('GPA.web', NOW - DAY)];
    const r = await runPlayVoidedPurchases({ nowMs: NOW, env: ENV });
    expect(r.unknown).toBe(1);
    expect(order('store_google_GPA.web').refundedInr).toBeUndefined();
  });

  it('🔒 missing configuration records "not-configured" and makes NO call at all', async () => {
    for (const env of [
      {} as NodeJS.ProcessEnv,
      { GOOGLE_PLAY_PACKAGE_NAME: 'com.navbharat.ai' } as NodeJS.ProcessEnv,
      { GOOGLE_PLAY_SA_JSON: SA_JSON } as NodeJS.ProcessEnv,
      { GOOGLE_PLAY_PACKAGE_NAME: 'com.navbharat.ai', GOOGLE_PLAY_SA_JSON: '{not json' } as NodeJS.ProcessEnv,
    ]) {
      calls.length = 0;
      const r = await runPlayVoidedPurchases({ nowMs: NOW, env });
      expect(r.status).toBe('not-configured');
      expect(r.reason).toMatch(/GOOGLE_PLAY_/);
      expect(calls).toEqual([]);
      expect(jobRun()?.lastResult?.status).toBe('not-configured');
    }
    expect(cursorDoc()).toBeUndefined();
  });

  it('Google refusing the call (no "View financial data" permission) is "refused" with the fix named — never an empty success', async () => {
    creditedPlayPack('GPA.x');
    play.voided = [voided('GPA.x', NOW - DAY)];
    play.status = 403;
    const r = await runPlayVoidedPurchases({ nowMs: NOW, env: ENV });
    expect(r.status).toBe('refused');
    expect(r.reason).toContain('View financial data');
    expect(cursorDoc()).toBeUndefined();
    expect(wallet().tokenBalance).toBe(9_900);
    expect(playRefundCheckText(playRefundCheckView(jobRun()))).toMatch(/NOT being checked: Google refused/);
  });
});

describe('paging', () => {
  it('🔒 every page is read through nextPageToken, and the cursor follows each applied page', async () => {
    for (const ref of ['GPA.p1', 'GPA.p2', 'GPA.p3', 'GPA.p4', 'GPA.p5']) creditedPlayPack(ref, `u_${ref}`);
    play.voided = ['GPA.p1', 'GPA.p2', 'GPA.p3', 'GPA.p4', 'GPA.p5'].map((ref, i) => voided(ref, NOW - (5 - i) * 60_000));
    play.pageSize = 2;

    const r = await runPlayVoidedPurchases({ nowMs: NOW, env: ENV });

    expect(r.status).toBe('ok');
    expect(r).toMatchObject({ pages: 3, seen: 5, reversed: 5, errors: 0 });
    const tokens = voidedCalls().map((u) => new URL(u).searchParams.get('token'));
    expect(tokens).toEqual([null, '2', '4']);
    // One access token for the whole run.
    expect(calls.filter((u) => u.startsWith('https://oauth2.googleapis.com/token'))).toHaveLength(1);
    expect(cursorDoc()?.lastVoidedTimeMillis).toBe(NOW - 60_000);
  });

  it('a run stopped by its page bound says so and keeps the cursor at the last applied page', async () => {
    for (const ref of ['GPA.q1', 'GPA.q2', 'GPA.q3']) creditedPlayPack(ref, `u_${ref}`);
    play.voided = ['GPA.q1', 'GPA.q2', 'GPA.q3'].map((ref, i) => voided(ref, NOW - (3 - i) * 60_000));
    play.pageSize = 1;
    const r = await runPlayVoidedPurchases({ nowMs: NOW, env: ENV, maxPages: 2 });
    expect(r.status).toBe('partial');
    expect(r.reversed).toBe(2);
    expect(cursorDoc()?.lastVoidedTimeMillis).toBe(NOW - 2 * 60_000);
  });
});

describe('admin visibility and wiring', () => {
  it('the run is recorded beside the scheduler\'s own record, and the Revenue page states it plainly', async () => {
    creditedPlayPack('GPA.v');
    play.voided = [voided('GPA.v', NOW - DAY), voided('GPA.unknown', NOW - DAY + 1)];
    store.set(`job_runs/${PLAY_VOIDED_JOB}`, { jobId: PLAY_VOIDED_JOB, lastRunAt: 123 });
    await runPlayVoidedPurchases({ nowMs: NOW, env: ENV });
    const rec = jobRun()!;
    expect(rec.lastRunAt).toBe(123); // the scheduler's field survives (merge)
    const view = playRefundCheckView(rec);
    expect(view).toMatchObject({ status: 'ok', seen: 2, reversed: 1, unknown: 1, errors: 0 });
    expect(playRefundCheckText(view)).toBe('Google Play refunds: last checked 2026-10-06 06:00 UTC — 2 voided, 1 taken back, 0 already done, 1 not ours.');
    expect(playRefundCheckText(playRefundCheckView(null))).toMatch(/has not run yet/);
    expect(playRefundCheckText(playRefundCheckView({ lastResult: { status: 'not-configured', reason: 'x' } }))).toMatch(/NOT being checked/);
  });

  const code = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').split('\n')
    .filter((l) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); }).join('\n');

  it('it runs daily through the shared scheduler, exclusive, under the id its record uses', () => {
    const server = code('server.ts');
    const at = server.indexOf(`id: '${PLAY_VOIDED_JOB}'`);
    expect(at).toBeGreaterThan(-1);
    const block = server.slice(at, at + 600);
    expect(block).toContain('exclusive: true');
    expect(block).toContain("kind: 'dailyAtUtc'");
    expect(block).toContain('runPlayVoidedPurchases()');
  });

  it('it reuses the verifier\'s service-account auth and the ONE reversal path — no second copy of either', () => {
    const job = code('src/server/lib/playVoidedPurchases.ts');
    expect(job).toContain('googleAccessToken(');
    expect(job).toContain('applyOrderReversal(');
    expect(job).not.toContain('oauth2.googleapis.com');
    expect(job).not.toMatch(/crypto\.sign|computeClawedBackWallet|mirroredCreditPatch/);
  });

  it('the admin purchases route returns the check beside the summary', () => {
    const src = code('src/server/routes/admin.ts');
    const at = src.indexOf("app.get('/api/admin/purchases', verifyAdminToken");
    const handler = src.slice(at, src.indexOf("app.get('/api/admin/users'", at));
    expect(handler).toContain('playRefundCheck: playRefundCheckView(');
    expect(code('src/components/AdminDashboard.tsx')).toContain('playRefundCheckText(purchases.playRefundCheck)');
  });
});
