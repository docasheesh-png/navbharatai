// Q-616 (forensic audit 2026-10-04; admin decision 2026-10-05, option b) — an image is paid for BEFORE
// it is drawn: the day's slot and the ₹ price are taken before any engine runs, settled on delivery, and
// given back on every exit that did not deliver.
//
// The old route only READ the count and the balance up front and charged after delivery, fire-and-forget,
// clamped at the overdraft floor — so concurrent requests each passed the check and the extra pictures
// went uncharged or pushed the wallet into overdraft.
//
// These tests run the REAL route, the REAL `ToolUsageStore` transactions and the REAL wallet debit/hold/
// release code against an in-memory Firestore whose transactions are SERIALISED (Firestore's guarantee:
// two transactions on the same document behave as if one ran after the other). Only the network and the
// account lookup are faked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

type Doc = Record<string, any>;
const db = vi.hoisted(() => {
  const store = new Map<string, Record<string, any>>();
  // The admin-SDK shape a plain (non-transactional) read uses — `getTodayCount` reads this way.
  const handle = {
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const d = store.get(`${c}/${id}`);
          return { exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined) };
        },
      }),
    }),
  };
  return { store, txCount: 0, handle };
});
const spend = vi.hoisted(() => ({ records: [] as Array<{ feature: string; inr: number }> }));

vi.mock('../src/server/lib/serverDb', () => {
  const key = (ref: { path: string }) => ref.path;
  const snap = (ref: { path: string }) => {
    const d = db.store.get(key(ref));
    return { exists: () => d !== undefined, data: () => (d ? structuredClone(d) : undefined) };
  };
  // One transaction at a time — serialisable isolation, which is what Firestore's optimistic retries give.
  let chain: Promise<unknown> = Promise.resolve();
  const runTransaction = (_db: unknown, body: (tx: any) => Promise<unknown>) => {
    const run = chain.then(async () => {
      db.txCount += 1;
      const writes: Array<() => void> = [];
      const tx = {
        get: async (ref: { path: string }) => snap(ref),
        set: (ref: { path: string }, data: Doc) => writes.push(() => db.store.set(key(ref), structuredClone(data))),
        update: (ref: { path: string }, patch: Doc) => writes.push(() => db.store.set(key(ref), { ...(db.store.get(key(ref)) ?? {}), ...patch })),
      };
      const out = await body(tx);
      for (const w of writes) w();
      return out;
    });
    chain = run.catch(() => undefined);
    return run;
  };
  return {
    getServerDb: () => db.handle,
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    getDoc: async (ref: { path: string }) => snap(ref),
    runTransaction,
  };
});

// The REAL store class, bound to the in-memory database above (production binds the shared handle).
vi.mock('../src/server/tools/ToolUsageStore', async (orig) => {
  const m = await orig<typeof import('../src/server/tools/ToolUsageStore')>();
  return { ...m, toolUsageStore: new m.ToolUsageStore(() => db.handle as any) };
});
vi.mock('../src/server/lib/FeatureSpendStore', () => ({
  featureSpendStore: { record: async (feature: string, inr: number) => { spend.records.push({ feature, inr }); } },
}));
const keyUsage = vi.hoisted(() => ({ recorded: [] as number[] }));
vi.mock('../src/server/lib/ApiKeyUsageStore', () => ({
  apiKeyUsageStore: {
    spentToday: async () => ({ spentInr: 0, calls: 0 }),
    record: async (_k: string, _d: string, inr: number) => { keyUsage.recorded.push(inr); },
  },
}));
vi.mock('../src/server/lib/uidEmail', () => ({ emailForUid: async () => 'u1@example.com' }));
vi.mock('../src/server/lib/costlyAiAccess', () => ({
  requireAccountForCostlyAi: async () => ({ ok: true, uid: 'u1', email: 'u1@example.com' }),
}));

import { istDayKey } from '../src/server/professionals/ProfessionalUsageStore';
import { WALLET_EMPTY_CODE } from '../src/server/lib/walletEmptyNotice';
import { reserveImage } from '../src/server/lib/imageHold';
import { buildWalletStatement } from '../src/server/lib/walletStatement';
import {
  computeRolledUpDebit, computeRolledUpRelease, releaseWalletHold,
} from '../src/server/lib/walletDebit';
import { featureRollupRef } from '../src/server/lib/walletFeature';
import { imageForApiKey } from '../src/server/lib/apiKeyImage';

const JPEG = '/9j/4AAQSkZJRgABAQ==';
const COUNT = 'tool_daily_usage/u1__image';
const WALLET = 'user_token_wallets/u1';

function setCount(n: number) {
  db.store.set(COUNT, { userId: 'u1', bucket: 'image', date: istDayKey(Date.now()), count: n, updatedAt: '' });
}
const count = () => Number(db.store.get(COUNT)?.count ?? 0);
function setWallet(inr: number, extra: Doc = {}) {
  // The opening balance is recorded, so the statement can be checked: opening + Σ rows = balance.
  const tokens = Math.round(inr * 100);
  db.store.set(WALLET, { userId: 'u1', tokenBalance: tokens, remaining_balance: inr, totalTokensUsed: 0, walletLedger: [], ledgerOpeningTokens: tokens, ...extra });
}
const wallet = () => db.store.get(WALLET)!;
const imageRow = () => (wallet().walletLedger as Doc[]).find((r) => r.rollupRef === featureRollupRef('image', Date.now()));
/** The statement still balances: opening + Σ rows = balance. */
const reconciles = () => {
  const s = buildWalletStatement(wallet());
  return s.expectedTokens === wallet().tokenBalance;
};

// ── the provider: Cloudflare is the first rung; a gate lets a test hold every draw open at once ─────────
let providerCalls = 0;
let providerMode: 'ok' | 'fail' = 'ok';
let release: (() => void) | null = null;
let gate: Promise<void> = Promise.resolve();
function holdDrawsOpen() { gate = new Promise<void>((r) => { release = r; }); }

const saved = { ...process.env };
beforeEach(() => {
  db.store.clear(); db.txCount = 0; spend.records = []; keyUsage.recorded = [];
  providerCalls = 0; providerMode = 'ok'; gate = Promise.resolve(); release = null;
  for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GROK_API_KEY', 'XAI_API_KEY',
    'IMAGE_GEN_POLLINATIONS', 'POLLINATIONS_API_KEY', 'AGENTV3_FREE_LIST', 'AI_IMAGE_PRICING', 'AI_IMAGE_PRICE_INR',
    'AI_IMAGE_FREE_PER_DAY', 'CLOUDFLARE_AI_TOKEN', 'IMAGE_GEN_CLOUDFLARE', 'WALLET_MERGE_RESOLVE']) delete process.env[k];
  process.env.IMAGE_GEN_POLLINATIONS = 'off';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'acc1';
  process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('https://api.cloudflare.com/')) {
      providerCalls += 1;
      await gate;
      if (providerMode === 'fail') return new Response('down', { status: 500 });
      return new Response(JSON.stringify({ success: true, result: { image: JPEG } }), { status: 200 });
    }
    return new Response('no', { status: 500 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...saved };
});

async function generate(res = mockRes()) {
  const { registerImageGenRoutes } = await import('../src/server/routes/imageGen');
  const routes = captureRoutes(registerImageGenRoutes);
  await routes.get('POST /api/image/generate')!(
    mockReq({ body: { prompt: 'a red camera', size: 'square', type: 'Photograph', tier: 'paid' } }), res,
  );
  return res;
}

describe('Q-616 · the slot and the price are taken before the picture is drawn', () => {
  it('two requests at the same moment with 4 used: exactly one is free and exactly one is charged ₹1', async () => {
    setCount(4); setWallet(10);
    holdDrawsOpen();
    const pending = [generate(), generate()];
    await vi.waitFor(() => expect(providerCalls).toBe(2), { timeout: 10_000 }); // both are drawing at once
    release!();
    const [a, b] = await Promise.all(pending);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect([a.body.chargedInr, b.body.chargedInr].sort()).toEqual([0, 1]);
    expect(count()).toBe(6);
    expect(wallet().tokenBalance).toBe(900);
    expect(imageRow()!.amountCoinsOrTokens).toBe(-100);
    expect(reconciles()).toBe(true);
  });

  it('two requests with the free ones used and exactly ₹1: one is drawn and charged, the other refused before any engine — never overdraft', async () => {
    setCount(5); setWallet(1);
    holdDrawsOpen();
    const pending = [generate(), generate()];
    await vi.waitFor(() => expect(providerCalls).toBe(1), { timeout: 10_000 });
    release!();
    const results = await Promise.all(pending);
    const ok = results.filter((r) => r.statusCode === 200);
    const refused = results.filter((r) => r.statusCode === 402);
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(ok[0].body.chargedInr).toBe(1);
    expect(refused[0].body.code).toBe(WALLET_EMPTY_CODE);
    expect(providerCalls).toBe(1);
    expect(wallet().tokenBalance).toBe(0);
    expect(count()).toBe(6); // the refused one's slot came back
    expect(reconciles()).toBe(true);
  });

  it('a balance that cannot cover the price: refused with the wallet-empty answer, nothing drawn, nothing taken, the slot returned', async () => {
    setCount(5); setWallet(0.5);
    const res = await generate();
    expect(res.statusCode).toBe(402);
    expect(res.body.code).toBe(WALLET_EMPTY_CODE);
    expect(String(res.body.error)).toMatch(/used your 5 free images for today/);
    expect(String(res.body.error)).toMatch(/₹0\.50/);
    expect(providerCalls).toBe(0);
    expect(count()).toBe(5);
    expect(wallet().tokenBalance).toBe(50);
    expect(wallet().walletLedger).toEqual([]);
  });

  it('every engine fails: the held ₹1 comes back and so does the slot', async () => {
    setCount(7); setWallet(5);
    providerMode = 'fail';
    const res = await generate();
    expect(res.statusCode).toBe(502);
    expect(providerCalls).toBe(1);
    expect(wallet().tokenBalance).toBe(500);
    expect(wallet().remaining_balance).toBe(5);
    expect(wallet().totalTokensUsed).toBe(0);
    expect(count()).toBe(7);
    expect(imageRow()!.amountCoinsOrTokens === 0 || imageRow()!.amountCoinsOrTokens === -0).toBe(true);
    expect(imageRow()!.openHolds).toBeUndefined();
    expect(reconciles()).toBe(true);
    expect(spend.records).toEqual([]); // nothing was spent, so nothing is reported as spent
  });

  it('a thrown error after the draw: the same — ₹1 back, slot back', async () => {
    setCount(5); setWallet(3);
    const res = mockRes();
    const realJson = res.json.bind(res);
    let calls = 0;
    res.json = (payload: any) => {
      calls += 1;
      if (calls === 1) throw new Error('response could not be written');
      return realJson(payload);
    };
    await generate(res);
    expect(res.statusCode).toBe(503);
    expect(wallet().tokenBalance).toBe(300);
    expect(count()).toBe(5);
    expect(reconciles()).toBe(true);
  });

  it('delivery: charged exactly once, settled, and the hold closed', async () => {
    setCount(5); setWallet(3);
    const res = await generate();
    expect(res.statusCode).toBe(200);
    expect(res.body.chargedInr).toBe(1);
    expect(res.body.freeLeftToday).toBe(0);
    expect(wallet().tokenBalance).toBe(200);
    expect(imageRow()!.amountCoinsOrTokens).toBe(-100);
    expect(imageRow()!.openHolds).toBeUndefined();
    expect(count()).toBe(6);
    await vi.waitFor(() => expect(spend.records).toEqual([{ feature: 'image', inr: 1 }])); // telemetry is fire-and-forget
    expect(reconciles()).toBe(true);
  });

  it('a free picture is counted once and charges nothing; a failed free picture gives its slot back', async () => {
    setCount(1); setWallet(0);
    expect((await generate()).body.chargedInr).toBe(0);
    expect(count()).toBe(2);
    providerMode = 'fail';
    expect((await generate()).statusCode).toBe(502);
    expect(count()).toBe(2);
    expect(wallet().tokenBalance).toBe(0);
  });

  it('a screen that never showed the price is refused past the free ones, and its slot is returned', async () => {
    setCount(5); setWallet(10);
    const { registerImageGenRoutes } = await import('../src/server/routes/imageGen');
    const routes = captureRoutes(registerImageGenRoutes);
    const res = mockRes();
    await routes.get('POST /api/image/generate')!(mockReq({ body: { prompt: 'a red camera', size: 'square' } }), res);
    expect(res.statusCode).toBe(429);
    expect(providerCalls).toBe(0);
    expect(count()).toBe(5);
    expect(wallet().tokenBalance).toBe(1000);
  });

  it('free-listed and pricing-off callers are neither counted nor charged (unchanged)', async () => {
    setCount(50); setWallet(0);
    process.env.AGENTV3_FREE_LIST = 'u1@example.com';
    expect((await generate()).statusCode).toBe(200);
    delete process.env.AGENTV3_FREE_LIST;
    process.env.AI_IMAGE_PRICING = 'off';
    expect((await generate()).statusCode).toBe(200);
    expect(count()).toBe(50);
    expect(wallet().tokenBalance).toBe(0);
  });
});

describe('Q-616 · the hold itself', () => {
  it('release is idempotent: twice, or after a settle, it gives nothing more back', async () => {
    setCount(5); setWallet(2);
    const r = await reserveImage({ uid: 'u1', freeListed: false, priceShown: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(wallet().tokenBalance).toBe(100);
    const holdId = imageRow()!.openHolds[0].id as string;
    await r.hold.release('test');
    await r.hold.release('test again');
    expect(wallet().tokenBalance).toBe(200);
    expect(count()).toBe(5);
    // And straight at the store — the same hold id again, then one never taken — nothing more comes back.
    const rollupRef = featureRollupRef('image', Date.now());
    for (const id of [holdId, 'img_unknown']) {
      const again = await releaseWalletHold(db.handle, 'u1', { rollupRef, holdId: id, description: 'Image Generator AI' });
      expect(again).toMatchObject({ ok: true, released: false });
    }
    expect(wallet().tokenBalance).toBe(200);

    const s = await reserveImage({ uid: 'u1', freeListed: false, priceShown: true });
    if (!s.ok) throw new Error('expected a hold');
    await s.hold.settle();
    await s.hold.release('after settle');
    expect(wallet().tokenBalance).toBe(100);
    expect(count()).toBe(6);
  });

  it('a hold is all or nothing and never takes a wallet below zero, wherever the overdraft floor sits', () => {
    const w = { tokenBalance: 99, remaining_balance: 0.99, walletLedger: [] };
    const out = computeRolledUpDebit(w, { billedInr: 1, rollupRef: 'r', description: 'x', floorInr: 0, allOrNothing: true, holdId: 'h' }, 'now');
    expect(out).toMatchObject({ applied: false, refused: true, tokensDebited: 0 });
    expect(out.wallet).toBe(w);
    // The ordinary (settle-after) debit still clamps, exactly as before.
    const clamped = computeRolledUpDebit(w, { billedInr: 1, rollupRef: 'r', description: 'x', floorInr: 0 }, 'now');
    expect(clamped.applied).toBe(true);
    expect(clamped.wallet.tokenBalance).toBe(0);
  });

  it('a release is the exact inverse of the hold — a fractional price, a carry and a gift included', () => {
    const start = { tokenBalance: 1000, remaining_balance: 10, totalTokensUsed: 40, giftTokensRemaining: 30, tokenCarry: 0.7, walletLedger: [] };
    const held = computeRolledUpDebit(start, { billedInr: 0.555, rollupRef: 'r', description: 'Image Generator AI', feature: 'image', floorInr: 0, allOrNothing: true, holdId: 'h1' }, 'now');
    expect(held.applied).toBe(true);
    const back = computeRolledUpRelease(held.wallet, { rollupRef: 'r', holdId: 'h1', description: 'Image Generator AI', feature: 'image' }, 'later');
    expect(back.applied).toBe(true);
    for (const k of ['tokenBalance', 'remaining_balance', 'totalTokensUsed', 'giftTokensRemaining'] as const) {
      expect(back.wallet[k], k).toBeCloseTo((start as Doc)[k], 6);
    }
    expect(back.wallet.walletLedger[0].amountCoinsOrTokens === 0 || back.wallet.walletLedger[0].amountCoinsOrTokens === -0).toBe(true);
    // Twice is once.
    expect(computeRolledUpRelease(back.wallet, { rollupRef: 'r', holdId: 'h1', description: 'Image Generator AI' }, 'x').applied).toBe(false);
  });

  it('a plain charge into the same bucket keeps an in-flight hold returnable', () => {
    const held = computeRolledUpDebit({ tokenBalance: 500, walletLedger: [] }, { billedInr: 1, rollupRef: 'r', description: 'x', floorInr: 0, allOrNothing: true, holdId: 'h1' }, 'now');
    const plain = computeRolledUpDebit(held.wallet, { billedInr: 1, rollupRef: 'r', description: 'x' }, 'now');
    expect(plain.wallet.walletLedger[0].openHolds).toEqual([expect.objectContaining({ id: 'h1' })]);
    const back = computeRolledUpRelease(plain.wallet, { rollupRef: 'r', holdId: 'h1', description: 'x' }, 'now');
    expect(back.wallet.tokenBalance).toBe(400);
    expect(back.wallet.walletLedger[0].amountCoinsOrTokens).toBe(-100);
  });
});

describe('Q-616 · the same rule at the other door (NavBharatAI API key / app pictures)', () => {
  const auth = { userId: 'u1', keyId: 'k1', scopes: ['ai:images'] };
  const SQ = { w: 1024, h: 1024 };

  it('free ones used and under ₹1: refused before any engine, nothing taken, slot returned', async () => {
    setCount(5); setWallet(0.4);
    const r = await imageForApiKey(auth, 'a red camera', SQ, 'api');
    expect(r).toMatchObject({ ok: false, status: 402, code: 'insufficient_balance' });
    expect(providerCalls).toBe(0);
    expect(count()).toBe(5);
    expect(wallet().tokenBalance).toBe(40);
  });

  it('every engine fails: the held ₹1 and the slot come back, and the key is charged nothing', async () => {
    setCount(5); setWallet(2);
    providerMode = 'fail';
    const r = await imageForApiKey(auth, 'a red camera', SQ, 'api');
    expect(r).toMatchObject({ ok: false, code: 'engine_unavailable' });
    expect(wallet().tokenBalance).toBe(200);
    expect(count()).toBe(5);
    expect(keyUsage.recorded).toEqual([]);
    expect(reconciles()).toBe(true);
  });

  it('two at once with exactly ₹1: one picture, one refusal, never overdraft', async () => {
    setCount(5); setWallet(1);
    const [a, b] = await Promise.all([imageForApiKey(auth, 'a red camera', SQ, 'api'), imageForApiKey(auth, 'a red camera', SQ, 'app')]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(providerCalls).toBe(1);
    expect(wallet().tokenBalance).toBe(0);
    expect(keyUsage.recorded).toEqual([1]);
  });

  it('🔒 SOURCE — no door reads the balance up front and charges after the picture any more', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const code = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of ['src/server/routes/imageGen.ts', 'src/server/lib/navbharatImageEngine.ts', 'src/server/lib/apiKeyImage.ts']) {
      const src = code(f);
      expect(src, f).not.toMatch(/debitWalletRolledUp|readWalletBalanceInr|toolUsageStore\.increment|decideImageStart/);
    }
    for (const f of ['src/server/routes/imageGen.ts', 'src/server/lib/apiKeyImage.ts']) {
      const src = code(f);
      expect(src, f).toMatch(/reserveImage\(/);
      expect(src, f).toMatch(/finally \{[\s\S]{0,400}if \(!delivered[^)]*\) await [a-z]+\??\.release\(/);
    }
  });
});
