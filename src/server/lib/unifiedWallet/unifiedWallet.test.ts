import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  unifiedWalletConfig, unifiedWalletEnabled, dailyAllowance, milliToTokens, milliToInr, gstBreakdown,
  unifiedBuildBilledUsd, detectLang, insufficientBalanceMessage, lowBalanceNotice, rechargePackView,
} from './policy';
import { UnifiedWalletGate, holdChatMessage, finishChatMessage, holdService, finishService, SERVICE_FEATURE, type WalletMoneyOps } from './store';
import { takeTextSlotForFreeImage, imageCountsAgainstText } from './imageTextQuota';
import { computeRolledUpDebit, computeRolledUpRelease, computeDebitedWallet } from '../walletDebit';
import { FreeAnswerQuotaStore } from '../freeAnswerQuotaStore';

function fixture() {
  const docs = new Map<string, any>();
  let serial = Promise.resolve();
  const db = {
    doc: (path: string) => ({ path, get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }) }),
    runTransaction: (run: (tx: any) => Promise<unknown>) => {
      const result = serial.then(async () => {
        const writes = new Map<string, unknown>();
        const r = await run({
          get: async (ref: { path: string }) => ({ exists: docs.has(ref.path), data: () => structuredClone(docs.get(ref.path)) }),
          set: (ref: { path: string }, value: unknown) => writes.set(ref.path, structuredClone(value)),
        });
        for (const [k, v] of writes) docs.set(k, v);
        return r;
      });
      serial = result.then(() => {}, () => {});
      return result;
    },
  } as unknown as Pick<Firestore, 'doc' | 'runTransaction'>;
  return { docs, db };
}
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-23T10:00:00.000Z';

describe('unified wallet policy', () => {
  it('is OFF by default and owner defaults are config-driven', () => {
    expect(unifiedWalletEnabled({})).toBe(false);
    const c = unifiedWalletConfig({});
    expect(c).toMatchObject({ enabled: false, chatMessageMilli: 100, guestDailyMessages: 5, signedInDailyMessages: 25, buildMargin: 2.5 });
    expect('minRechargeInr' in c).toBe(false); // existing ₹1 minimum stays; no new minimum
    expect(c.rechargePacksInr).toEqual([20, 50, 100, 500]);
    expect(unifiedWalletConfig({ UNIFIED_WALLET_RECHARGE_PACKS: '500, 10, 50,50' }).rechargePacksInr).toEqual([10, 50, 500]); // any ₹ ≥ 1, deduped, sorted
    expect('plans' in c).toBe(false); // owner: no subscriptions
    expect(unifiedWalletConfig({ UNIFIED_WALLET_ENABLED: '1', UNIFIED_WALLET_BUILD_MARGIN: '2' })).toMatchObject({ enabled: true, buildMargin: 2 });
  });
  it('uses integer milli-credits: ₹1 = 10 messages = 100 tokens', () => {
    expect(milliToTokens(100)).toBe(10);
    expect(milliToInr(100)).toBe(0.1);
    expect(() => milliToTokens(105)).toThrow();
    expect(() => milliToTokens(0)).toThrow();
    expect(unifiedWalletConfig({ UNIFIED_WALLET_CHAT_MESSAGE_MILLI: '105' }).chatMessageMilli).toBe(100);
  });
  it('allowances: guest 5, signed-in 25, then pay-and-use', () => {
    const c = unifiedWalletConfig({});
    expect(dailyAllowance(c, { signedIn: false })).toBe(5);
    expect(dailyAllowance(c, { signedIn: true })).toBe(25);
  });
  it('recharge packs show GST-inclusive price and what they buy', () => {
    const v = rechargePackView(unifiedWalletConfig({}));
    expect(v[0]).toMatchObject({ priceInrInclGst: 20, totalPaise: 2000, credits: 20, chatMessages: 200 });
    expect(v.every((p) => p.basePaise + p.gstPaise === p.totalPaise)).toBe(true);
  });
  it('shows GST-inclusive prices with an exact paise split', () => {
    expect(gstBreakdown(99, 18)).toEqual({ totalPaise: 9900, basePaise: 8390, gstPaise: 1510 });
    const b = gstBreakdown(999, 18); expect(b.basePaise + b.gstPaise).toBe(99900);
  });
  it('build margin, min recharge, language messages', () => {
    expect(unifiedBuildBilledUsd(0.5, { buildMargin: 2 })).toBe(1);
    expect(unifiedBuildBilledUsd(-1, { buildMargin: 2 })).toBe(0);
    expect(detectLang('GST क्या है')).toBe('hi');
    expect(detectLang('mujhe GST samjhao')).toBe('hinglish');
    expect(detectLang('Explain GST')).toBe('en');
    const c = unifiedWalletConfig({});
    expect(insufficientBalanceMessage('hi', c)).toContain('recharge');
    expect(insufficientBalanceMessage('en', c)).toContain('₹1 = 10 messages');
    expect(lowBalanceNotice('en', 400, c)).toContain('4.00 credits');
    expect(lowBalanceNotice('en', 600, c)).toBe('');
  });
});

describe('Free + Pro debit ONE wallet (existing pure money functions)', () => {
  const chat = (holdId: string) => ({ feature: 'free-chat' as const, billedInr: milliToInr(100), rollupRef: 'ai_2026-10-23_free-chat', holdId, description: 'Free chat', floorInr: 0, allOrNothing: true });
  it('a chat message and a build come out of the same balance', () => {
    let w: any = { tokenBalance: 2000, remaining_balance: 20, walletLedger: [] }; // ₹20 recharge
    w = computeRolledUpDebit(w, chat('a'), NOW).wallet;
    expect(w.tokenBalance).toBe(1990);
    w = computeDebitedWallet(w, { feature: 'build', billedInr: 15, buildRef: 'b1', description: 'Build' }, NOW).wallet;
    expect(w.tokenBalance).toBe(490);
    const rows = w.walletLedger.map((r: any) => r.feature);
    expect(rows).toEqual(expect.arrayContaining(['free-chat', 'build']));
  });
  it('refuses a chat hold the balance cannot cover, never overdrawing', () => {
    const r = computeRolledUpDebit({ tokenBalance: 5, walletLedger: [] }, chat('x'), NOW);
    expect(r.refused).toBe(true);
    expect(r.applied).toBe(false);
  });
  it('is idempotent per hold id and refunds a failed reply exactly once', () => {
    const w1 = computeRolledUpDebit({ tokenBalance: 100, walletLedger: [] }, chat('h1'), NOW).wallet;
    const again = computeRolledUpDebit(w1, chat('h1'), NOW);
    expect(again.applied).toBe(false);
    const rel = computeRolledUpRelease(w1, { rollupRef: 'ai_2026-10-23_free-chat', holdId: 'h1', description: 'Free chat' }, NOW);
    expect(rel.wallet.tokenBalance).toBe(100);
    expect(computeRolledUpRelease(rel.wallet, { rollupRef: 'ai_2026-10-23_free-chat', holdId: 'h1', description: 'Free chat' }, NOW).applied).toBe(false);
  });
  it('a build bill that exceeds the balance is still capped by the existing overdraft floor', () => {
    const r = computeDebitedWallet({ tokenBalance: 100, walletLedger: [] }, { feature: 'build', billedInr: 10_000, buildRef: 'big', description: 'Build', floorInr: 0 }, NOW);
    expect(r.wallet.tokenBalance).toBe(0);
    expect(r.absorbedInr).toBeGreaterThan(0);
  });
});

describe('UnifiedWalletGate (per-minute limit + idempotency, atomic)', () => {
  const at = Date.parse('2026-10-23T10:00:05Z');
  it('admits at most N per minute under concurrency, across replicas', async () => {
    const { db } = fixture();
    const a = new UnifiedWalletGate(db); const b = new UnifiedWalletGate(db);
    const out = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).admit('user:u1', uuid(i), 20, at)));
    expect(out.filter((o) => o.ok)).toHaveLength(20);
    expect(out.filter((o) => !o.ok && o.reason === 'rate-limited')).toHaveLength(10);
    expect((await a.admit('user:u1', uuid(99), 20, at + 60_000)).ok).toBe(true); // next minute
  });
  it('rejects a replayed request id even in a later minute', async () => {
    const { db } = fixture(); const g = new UnifiedWalletGate(db);
    expect((await g.admit('user:u1', uuid(1), 20, at)).ok).toBe(true);
    expect(await g.admit('user:u1', uuid(1), 20, at + 120_000)).toEqual({ ok: false, reason: 'duplicate' });
  });
});

describe('chat charge orchestration', () => {
  const cfg = unifiedWalletConfig({ UNIFIED_WALLET_ENABLED: '1' });
  const ops = (insufficient = false): WalletMoneyOps => ({
    hold: vi.fn(async () => insufficient
      ? { ok: false as const, insufficient: true as const, balanceInr: 0.05, error: 'low' }
      : { ok: true as const, ownerId: 'u1', tokensDebited: 10, tokenBalance: 990 }),
    release: vi.fn(async () => ({ ok: true as const, released: true, tokensReturned: 10 })),
    settle: vi.fn(async () => ({ ok: true as const, settled: true })),
  });
  it('holds 0.1 credit with the request id as idempotency key, settles on answer', async () => {
    const o = ops();
    const r = await holdChatMessage(null, 'u1', uuid(1), cfg, Date.parse(NOW), o);
    expect(r.ok).toBe(true);
    expect(o.hold).toHaveBeenCalledWith(null, 'u1', expect.objectContaining({ billedInr: 0.1, holdId: `uw_chat_${uuid(1)}`, feature: 'free-chat', description: expect.stringContaining('NavBharatAI Chat') }));
    if (r.ok) await finishChatMessage(null, 'u1', r.charge, 'answered', o);
    expect(o.settle).toHaveBeenCalled(); expect(o.release).not.toHaveBeenCalled();
  });
  it('releases on a proven provider failure, keeps the charge when uncertain', async () => {
    const o = ops();
    const r = await holdChatMessage(null, 'u1', uuid(2), cfg, Date.parse(NOW), o);
    if (!r.ok) throw new Error('hold');
    await finishChatMessage(null, 'u1', r.charge, 'provider-failed', o);
    expect(o.release).toHaveBeenCalledTimes(1);
    await finishChatMessage(null, 'u1', r.charge, 'uncertain', o);
    expect(o.settle).toHaveBeenCalledTimes(1);
  });
  it('reports insufficient balance without running the turn', async () => {
    const r = await holdChatMessage(null, 'u1', uuid(3), cfg, Date.parse(NOW), ops(true));
    expect(r).toMatchObject({ ok: false, insufficient: true });
  });
});

describe('allowance reset at midnight IST (existing Free answer store, configured limit)', () => {
  it('25 a day for a signed-in user, the 26th refused, fresh after 00:00 IST', async () => {
    const { db } = fixture(); const store = new FreeAnswerQuotaStore(db as any);
    const subject = { key: 'user:u1', limit: 25 };
    const t = Date.parse('2026-10-23T18:00:00Z'); // 23:30 IST
    for (let n = 1; n <= 25; n++) {
      const r = await store.reserve(subject, uuid(n), t + n);
      if (!r.allowed) throw new Error(r.reason);
      await store.settle(r.reservation, 'answered', t + n);
    }
    expect(await store.reserve(subject, uuid(26), t + 100)).toMatchObject({ allowed: false, reason: 'daily-limit' });
    const afterMidnightIst = Date.parse('2026-10-23T18:30:01Z');
    expect(await store.reserve(subject, uuid(27), afterMidnightIst)).toMatchObject({ allowed: true });
  });
  it('guest limit stays bound to the guest address key', async () => {
    const { db } = fixture(); const store = new FreeAnswerQuotaStore(db as any);
    const r = await store.reserve({ key: 'guest-device:d1', limit: 5, ipKey: '1.2.3.0', guest: true }, uuid(1), Date.parse(NOW));
    expect(r.allowed).toBe(true);
  });
});

describe('generic service debit (hosting, database, APK, App Mart, API can plug in)', () => {
  const ops = (): WalletMoneyOps => ({
    hold: vi.fn(async () => ({ ok: true as const, ownerId: 'u1', tokensDebited: 500, tokenBalance: 0 })),
    release: vi.fn(async () => ({ ok: true as const, released: true, tokensReturned: 500 })),
    settle: vi.fn(async () => ({ ok: true as const, settled: true })),
  });
  it('maps every service to an existing wallet feature', () => {
    expect(Object.keys(SERVICE_FEATURE).sort()).toEqual(['api', 'apk', 'appmart', 'build', 'chat', 'database', 'hosting', 'image']);
  });
  it('debits integer milli-credits with the caller idempotency key', async () => {
    const o = ops();
    const r = await holdService(null, 'u1', { service: 'database', amountMilli: 5000, idempotencyKey: 'db_2026-10-23_app1', description: 'App database' }, Date.parse(NOW), o);
    expect(r.ok).toBe(true);
    expect(o.hold).toHaveBeenCalledWith(null, 'u1', expect.objectContaining({ billedInr: 5, feature: 'database', holdId: 'uw_database_db_2026-10-23_app1' }));
    if (r.ok) await finishService(null, 'u1', r.charge, 'provider-failed', o);
    expect(o.release).toHaveBeenCalledTimes(1);
  });
  it('rejects fractional-paise amounts and bad keys before touching money', async () => {
    const o = ops();
    expect(await holdService(null, 'u1', { service: 'api', amountMilli: 15, idempotencyKey: 'abcdefgh1', description: 'x' }, 0, o)).toMatchObject({ ok: false });
    expect(await holdService(null, 'u1', { service: 'api', amountMilli: 10, idempotencyKey: 'bad key', description: 'x' }, 0, o)).toMatchObject({ ok: false });
    expect(o.hold).not.toHaveBeenCalled();
  });
});

describe('free image also uses a daily text message (config)', () => {
  const on = { UNIFIED_WALLET_ENABLED: '1' };
  it('is off with the flag off, and can be switched off by config', () => {
    expect(imageCountsAgainstText({})).toBe(false);
    expect(imageCountsAgainstText(on)).toBe(true);
    expect(imageCountsAgainstText({ ...on, UNIFIED_WALLET_IMAGE_COUNTS_TEXT: '0' })).toBe(false);
  });
  it('consumes one of the 25 text messages on delivery and gives it back if the image failed', async () => {
    const { db } = fixture(); const store = new FreeAnswerQuotaStore(db as any);
    const t = Date.parse(NOW);
    const slot = await takeTextSlotForFreeImage('u1', on, store, () => t);
    await slot.settle(true);
    expect(await store.status({ key: 'user:u1', limit: 25 }, t + 1)).toMatchObject({ used: 1, remaining: 24 });
    const failed = await takeTextSlotForFreeImage('u1', on, store, () => t + 2);
    await failed.settle(false);
    expect(await store.status({ key: 'user:u1', limit: 25 }, t + 3)).toMatchObject({ used: 1, remaining: 24 });
  });
});
