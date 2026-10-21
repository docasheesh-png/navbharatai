// HOUSE ADS — the server half: the store, who is shown an ad, and the two public routes (admin 2026-10-20).
//
// These run the REAL store and route code against a small in-memory Firestore, so what they prove is the real
// write order, the real picture check and the real "paid never sees one" decision — not a copy of the rules.
//
// The decisions held here, none visible to `tsc`:
//   1. A picture is judged by its BYTES, not by the label the browser put on it; SVG is refused outright.
//   2. WRITE ORDER: the picture lands before the ad, the ad leaves before the picture — an ad never points at a
//      picture that is not there.
//   3. The public list never carries picture bytes, and only LIVE ads for the asked place are served.
//   4. PAID NEVER SEES ONE: real money spent, or an active hosting plan. Gifted balance does not make anyone a
//      customer. Every doubt (wallet unreadable, token that fails to verify) is "no ad".
//   5. `{ ad: null }` is the answer to every failure; nothing is guessed.
import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../src/server/lib/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/server/lib/authMiddleware')>();
  return {
    ...real,
    rateLimiter: () => (_req: any, _res: any, next: () => void) => next(),
    // 'Bearer paid' / 'Bearer free' are signed-in users; any other bearer fails to verify, like an expired token.
    verifyFirebaseToken: async (req: any) => {
      const h = String(req.headers.authorization || '');
      if (h === 'Bearer paid') return 'u_paid';
      if (h === 'Bearer free') return 'u_free';
      if (h === 'Bearer plan') return 'u_plan';
      if (h === 'Bearer nowallet') return 'u_nowallet';
      return null;
    },
  };
});

import { setServerDb } from '../src/server/lib/serverDb';
import {
  checkAdImage, createHouseAd, updateHouseAd, deleteHouseAd, listHouseAds, servedAdFor, readAdImage,
  forgetPublicAds, AD_ID_RE, HOUSE_ADS_COLLECTION, HOUSE_AD_IMAGES_COLLECTION,
} from '../src/server/lib/houseAdStore';
import { audienceFromWallet, houseAdAudience, _clearAudienceCacheForTests } from '../src/server/lib/houseAdAudience';
import { registerHouseAdRoutes } from '../src/server/routes/houseAds';
import { HOUSE_AD_IMAGE_MAX_BYTES, HOUSE_AD_MAX_COUNT } from '../src/lib/houseAds';
import { HOSTING_PLAN_ID } from '../src/server/lib/hostingPlan';

// ── A minimal Firestore: the admin-SDK surface serverDb.ts calls, with an ordered write log. ──────────
function makeDb() {
  const store = new Map<string, any>();
  const log: string[] = [];
  let failNextSetOn: string | null = null;
  let reads = 0;
  const snap = (path: string) => {
    const has = store.has(path);
    return { exists: has, data: () => (has ? { ...store.get(path) } : undefined), id: path.split('/').pop()!, ref: { path }, get: (f: string) => store.get(path)?.[f] };
  };
  const db = {
    store, log,
    get reads() { return reads; },
    failNextSetOn: (prefix: string) => { failNextSetOn = prefix; },
    doc: (path: string) => ({
      path,
      get: async () => { reads++; return snap(path); },
      set: async (data: any) => {
        if (failNextSetOn && path.startsWith(failNextSetOn)) { failNextSetOn = null; throw new Error('write failed'); }
        log.push(`set ${path}`); store.set(path, { ...data });
      },
      update: async (data: any) => { log.push(`update ${path}`); store.set(path, { ...store.get(path), ...data }); },
      delete: async () => { log.push(`delete ${path}`); store.delete(path); },
    }),
    collection: (name: string) => ({
      get: async () => {
        reads++;
        const docs = [...store.keys()].filter((k) => k.startsWith(`${name}/`) && !k.slice(name.length + 1).includes('/')).map((k) => snap(k));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    }),
  };
  return db;
}

const b64 = (bytes: Buffer) => bytes.toString('base64');
const JPEG = (n = 200) => `data:image/jpeg;base64,${b64(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]))}`;
const PNG = () => `data:image/png;base64,${b64(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 2)]))}`;
const WEBP = () => `data:image/webp;base64,${b64(Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), Buffer.alloc(50, 3)]))}`;

const body = (over: Record<string, unknown> = {}) => ({
  name: 'Kumar Spices', description: 'Fresh masalas from Kerala.', linkUrl: 'https://kumarspices.in/', placements: ['mart_tile', 'dashboard', 'publish_success'],
  enabled: true, startsAt: null, endsAt: null, imageDataUrl: JPEG(), ...over,
});

const NOW = 1_800_000_000_000;
let db: ReturnType<typeof makeDb>;
beforeEach(() => { db = makeDb(); setServerDb(db as any); forgetPublicAds(); _clearAudienceCacheForTests(); });

describe('1 — a picture is judged by its bytes', () => {
  it('accepts a real JPEG, PNG and WebP', () => {
    expect(checkAdImage(JPEG()).ok).toBe(true);
    expect(checkAdImage(PNG()).ok).toBe(true);
    expect(checkAdImage(WEBP()).ok).toBe(true);
  });

  it('refuses SVG outright (it can carry script) and any other type', () => {
    const svg = `data:image/svg+xml;base64,${b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))}`;
    const r = checkAdImage(svg);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/JPG, PNG or WebP/);
    expect(checkAdImage(`data:text/html;base64,${b64(Buffer.from('<h1>x</h1>'))}`).ok).toBe(false);
    expect(checkAdImage(`data:application/pdf;base64,${b64(Buffer.from('%PDF-1.4'))}`).ok).toBe(false);
  });

  it('refuses a file whose bytes are not the format its label claims', () => {
    const htmlAsPng = `data:image/png;base64,${b64(Buffer.from('<html><script>alert(1)</script></html>'))}`;
    const r = checkAdImage(htmlAsPng);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/not really an image/);
    expect(checkAdImage(JPEG().replace('image/jpeg', 'image/png')).ok).toBe(false); // a JPEG labelled PNG
  });

  it('refuses a picture over the size limit, and accepts one exactly at it', () => {
    const header = 4;
    const atLimit = `data:image/jpeg;base64,${b64(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(HOUSE_AD_IMAGE_MAX_BYTES - header, 1)]))}`;
    const over = `data:image/jpeg;base64,${b64(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(HOUSE_AD_IMAGE_MAX_BYTES - header + 3, 1)]))}`;
    expect(checkAdImage(atLimit).ok).toBe(true);
    const r = checkAdImage(over);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/too large/);
  });

  it('refuses text that is not a data URL at all', () => {
    expect(checkAdImage('https://evil.example/x.png').ok).toBe(false);
    expect(checkAdImage('').ok).toBe(false);
  });
});

describe('2 — write order: an ad never points at a picture that is not there', () => {
  it('create writes the PICTURE first and the ad second, and the ad document carries no picture bytes', async () => {
    const r = await createHouseAd(db, body(), NOW);
    expect(r.ok).toBe(true);
    const id = (r as any).value.id as string;
    expect(id).toMatch(AD_ID_RE);
    expect(db.log).toEqual([`set ${HOUSE_AD_IMAGES_COLLECTION}/${id}`, `set ${HOUSE_ADS_COLLECTION}/${id}`]);
    const ad = db.store.get(`${HOUSE_ADS_COLLECTION}/${id}`);
    expect(JSON.stringify(ad)).not.toContain('base64');
    expect(ad).not.toHaveProperty('imageDataUrl');
    expect(ad.imageVersion).toBe(NOW);
  });

  it('a crash between the two writes leaves an unseen orphan picture and NO visible ad', async () => {
    db.failNextSetOn(HOUSE_ADS_COLLECTION);
    await expect(createHouseAd(db, body(), NOW)).rejects.toThrow('write failed');
    expect(await listHouseAds(db)).toEqual([]);
    expect(await servedAdFor(db, 'mart_tile', NOW)).toBeNull();
  });

  it('delete removes the ad FIRST and the picture second', async () => {
    const id = ((await createHouseAd(db, body(), NOW)) as any).value.id as string;
    db.log.length = 0;
    expect((await deleteHouseAd(db, id)).ok).toBe(true);
    expect(db.log).toEqual([`delete ${HOUSE_ADS_COLLECTION}/${id}`, `delete ${HOUSE_AD_IMAGES_COLLECTION}/${id}`]);
    expect(await listHouseAds(db)).toEqual([]);
  });

  it('refuses invalid input BEFORE touching the database', async () => {
    const r = await createHouseAd(db, body({ name: '' }), NOW);
    expect(r).toMatchObject({ ok: false, status: 400 });
    const r2 = await createHouseAd(db, body({ imageDataUrl: 'data:image/png;base64,AAAA' }), NOW);
    expect(r2).toMatchObject({ ok: false, status: 400 });
    expect(db.log).toEqual([]);
  });

  it('refuses the ad past the cap, saying how to make room', async () => {
    for (let i = 0; i < HOUSE_AD_MAX_COUNT; i++) {
      db.store.set(`${HOUSE_ADS_COLLECTION}/ad_${String(i).padStart(12, '0')}`, {
        name: `n${i}`, description: 'd', enabled: true, imageVersion: 1, placements: ['mart_tile'], startsAt: null, endsAt: null, linkUrl: null, createdAt: i, updatedAt: i,
      });
    }
    const r = await createHouseAd(db, body(), NOW);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((r as any).error).toMatch(/Delete one/);
  });
});

describe('edit and delete', () => {
  it('an edit without a picture keeps the stored picture and its version', async () => {
    const id = ((await createHouseAd(db, body(), NOW)) as any).value.id as string;
    const { imageDataUrl: _drop, ...noPicture } = body({ name: 'Renamed' });
    expect((await updateHouseAd(db, id, noPicture, NOW + 5)).ok).toBe(true);
    const ad = db.store.get(`${HOUSE_ADS_COLLECTION}/${id}`);
    expect(ad.name).toBe('Renamed');
    expect(ad.imageVersion).toBe(NOW);
    expect(ad.createdAt).toBe(NOW);
    expect(ad.updatedAt).toBe(NOW + 5);
  });

  it('an edit WITH a picture replaces it, and the picture URL changes so browsers re-fetch', async () => {
    const id = ((await createHouseAd(db, body(), NOW)) as any).value.id as string;
    const before = (await listHouseAds(db))[0].imageUrl;
    expect((await updateHouseAd(db, id, body({ imageDataUrl: PNG() }), NOW + 9)).ok).toBe(true);
    const after = (await listHouseAds(db))[0].imageUrl;
    expect(after).not.toBe(before);
    expect(after).toContain(`v=${NOW + 9}`);
    expect((await readAdImage(db, id))?.mime).toBe('image/png');
  });

  it('a bad new picture refuses the WHOLE edit and changes nothing', async () => {
    const id = ((await createHouseAd(db, body(), NOW)) as any).value.id as string;
    db.log.length = 0;
    const r = await updateHouseAd(db, id, body({ name: 'Changed', imageDataUrl: 'data:image/png;base64,AAAA' }), NOW + 1);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(db.store.get(`${HOUSE_ADS_COLLECTION}/${id}`).name).toBe('Kumar Spices');
  });

  it('an id that is not an ad, or an ad that is gone, is a 404 — never a write', async () => {
    expect(await updateHouseAd(db, 'nope', body(), NOW)).toMatchObject({ ok: false, status: 404 });
    expect(await updateHouseAd(db, 'ad_aaaaaaaaaaaa', body(), NOW)).toMatchObject({ ok: false, status: 404 });
    expect(await deleteHouseAd(db, '../../users/x')).toMatchObject({ ok: false, status: 404 });
    expect(await deleteHouseAd(db, 'ad_aaaaaaaaaaaa')).toMatchObject({ ok: false, status: 404 });
    expect(db.log).toEqual([]);
  });
});

describe('3 — the public list: live ads only, for the asked place, no picture bytes', () => {
  it('serves only a LIVE ad for the asked place', async () => {
    await createHouseAd(db, body({ name: 'Off one', enabled: false }), NOW);
    await createHouseAd(db, body({ name: 'Later', startsAt: NOW + 10_000 }), NOW);
    await createHouseAd(db, body({ name: 'Over', endsAt: NOW - 1 }), NOW);
    await createHouseAd(db, body({ name: 'Elsewhere', placements: ['mart_banner'] }), NOW);
    expect(await servedAdFor(db, 'mart_tile', NOW)).toBeNull();
    await createHouseAd(db, body({ name: 'Live one' }), NOW);
    const ad = await servedAdFor(db, 'mart_tile', NOW);
    expect(ad?.name).toBe('Live one');
    expect(await servedAdFor(db, 'mart_banner', NOW)).toMatchObject({ name: 'Elsewhere' });
  });

  it('the served ad carries a picture URL, never picture bytes', async () => {
    await createHouseAd(db, body(), NOW);
    const ad = await servedAdFor(db, 'dashboard', NOW);
    expect(ad?.imageUrl).toMatch(/^\/api\/ads\/image\/ad_[0-9a-f]{12}\?v=\d+$/);
    expect(JSON.stringify(ad)).not.toContain('base64');
    expect(Object.keys(ad as object).sort()).toEqual(['description', 'id', 'imageUrl', 'linkUrl', 'name']);
  });

  it('a change the admin makes is seen at once on this instance (no stale minute)', async () => {
    const id = ((await createHouseAd(db, body(), NOW)) as any).value.id as string;
    expect(await servedAdFor(db, 'mart_tile', NOW)).not.toBeNull();
    await updateHouseAd(db, id, body({ enabled: false }), NOW + 1);
    expect(await servedAdFor(db, 'mart_tile', NOW + 2)).toBeNull();
    await deleteHouseAd(db, id);
    expect(await servedAdFor(db, 'dashboard', NOW + 3)).toBeNull();
  });

  it('many requests share ONE read of the list', async () => {
    await createHouseAd(db, body(), NOW);
    forgetPublicAds();
    const before = db.reads;
    await Promise.all(Array.from({ length: 25 }, () => servedAdFor(db, 'mart_tile', NOW)));
    expect(db.reads - before).toBe(1);
  });

  it('a hand-damaged ad document is NO ad, not a half-drawn one', async () => {
    db.store.set(`${HOUSE_ADS_COLLECTION}/ad_bbbbbbbbbbbb`, { name: 'Broken', enabled: true });
    expect(await listHouseAds(db)).toEqual([]);
    expect(await servedAdFor(db, 'mart_tile', NOW)).toBeNull();
  });

  it('a stored picture that is not a valid image is NEVER served, even if a document says it is', async () => {
    const id = ((await createHouseAd(db, body(), NOW)) as any).value.id as string;
    db.store.set(`${HOUSE_AD_IMAGES_COLLECTION}/${id}`, { mime: 'image/png', base64: b64(Buffer.from('<script>alert(1)</script>')) });
    expect(await readAdImage(db, id)).toBeNull();
    expect(await readAdImage(db, '../x')).toBeNull();
    expect(await readAdImage(db, 'ad_cccccccccccc')).toBeNull();
  });
});

describe('4 — PAID NEVER SEES ONE', () => {
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();

  it('real money spent is ad-free — and a wallet that was only GIFTED is not', () => {
    expect(audienceFromWallet({ totalMoneySpent: 500 })).toBe('ad-free');
    expect(audienceFromWallet({ totalMoneySpent: 0, balance: 99999 })).toBe('ads');
    expect(audienceFromWallet({ balance: 1000 })).toBe('ads');
    expect(audienceFromWallet(null)).toBe('ads');
    expect(audienceFromWallet(undefined)).toBe('ads');
  });

  it('an ACTIVE hosting plan is ad-free even with no money ever spent (the plan promises "ad-free")', () => {
    expect(audienceFromWallet({ totalMoneySpent: 0, hostingPlan: { id: HOSTING_PLAN_ID, expiresAt: future } })).toBe('ad-free');
    expect(audienceFromWallet({ totalMoneySpent: 0, hostingPlan: { id: HOSTING_PLAN_ID, expiresAt: past } })).toBe('ads');
    expect(audienceFromWallet({ totalMoneySpent: 0, hostingPlan: { id: 'not-a-plan', expiresAt: future } })).toBe('ads');
  });

  it('an anonymous visitor is shown ads; a signed-in free account is shown ads too', async () => {
    db.store.set('user_token_wallets/u_free', { balance: 10, totalMoneySpent: 0 });
    expect(await houseAdAudience(null)).toBe('ads');
    expect(await houseAdAudience('u_free')).toBe('ads');
  });

  it('a signed-in account with NO wallet document yet is a free account, not an unknown one', async () => {
    expect(await houseAdAudience('u_brand_new')).toBe('ads');
  });

  it('a paying account is ad-free, and a hosting-plan holder is ad-free', async () => {
    db.store.set('user_token_wallets/u_paid', { totalMoneySpent: 250 });
    db.store.set('user_token_wallets/u_plan', { totalMoneySpent: 0, hostingPlan: { id: HOSTING_PLAN_ID, expiresAt: future } });
    expect(await houseAdAudience('u_paid')).toBe('ad-free');
    expect(await houseAdAudience('u_plan')).toBe('ad-free');
  });

  it('FAILS SAFE: a wallet that cannot be read is UNKNOWN (no ad), never "free"', async () => {
    const broken = { doc: () => ({ get: async () => { throw new Error('firestore down'); } }) };
    setServerDb(broken as any);
    expect(await houseAdAudience('u_paid')).toBe('unknown');
    setServerDb(null);
    expect(await houseAdAudience('u_paid')).toBe('unknown');
    expect(await houseAdAudience(null)).toBe('ads'); // an anonymous visitor has no wallet to fail to read
  });

  it('an unknown is not cached: the next request reads again', async () => {
    const flaky = makeDb();
    let calls = 0;
    const origDoc = flaky.doc;
    (flaky as any).doc = (p: string) => ({ ...origDoc(p), get: async () => { calls++; if (calls === 1) throw new Error('blip'); return { exists: true, data: () => ({ totalMoneySpent: 9 }), id: 'x', ref: { path: p }, get: () => undefined }; } });
    setServerDb(flaky as any);
    expect(await houseAdAudience('u_x')).toBe('unknown');
    expect(await houseAdAudience('u_x')).toBe('ad-free');
  });
});

describe('5 — the public routes: `{ ad: null }` answers every doubt', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const app = express();
    registerHouseAdRoutes(app);
    await new Promise<void>((res) => { server = app.listen(0, '127.0.0.1', () => res()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((res) => { server.close(() => res()); }));

  const get = (path: string, auth?: string) => fetch(`${base}${path}`, { headers: auth ? { Authorization: auth } : {} });
  const seed = async () => {
    db.store.set('user_token_wallets/u_paid', { totalMoneySpent: 250 });
    db.store.set('user_token_wallets/u_free', { balance: 5, totalMoneySpent: 0 });
    db.store.set('user_token_wallets/u_plan', { hostingPlan: { id: HOSTING_PLAN_ID, expiresAt: new Date(Date.now() + 86_400_000).toISOString() } });
    return ((await createHouseAd(db, body(), Date.now())) as any).value.id as string;
  };

  it('a visitor and a free signed-in user are shown the ad; a paying user and a plan holder are not', async () => {
    await seed();
    const anon = await (await get('/api/ads/mart_tile')).json();
    expect(anon.ad?.name).toBe('Kumar Spices');
    expect((await (await get('/api/ads/mart_tile', 'Bearer free')).json()).ad?.name).toBe('Kumar Spices');
    expect(await (await get('/api/ads/mart_tile', 'Bearer paid')).json()).toEqual({ ad: null });
    expect(await (await get('/api/ads/mart_tile', 'Bearer plan')).json()).toEqual({ ad: null });
  });

  it('a request that CARRIES a token which does not verify (an expired one) gets NO ad — it is not an anonymous visitor', async () => {
    await seed();
    expect(await (await get('/api/ads/mart_tile', 'Bearer expired-or-forged')).json()).toEqual({ ad: null });
  });

  it('the answer is private and varies by Authorization, so no shared cache can hand a visitor\'s ad to a payer', async () => {
    await seed();
    const res = await get('/api/ads/dashboard');
    expect(res.headers.get('cache-control')).toMatch(/private/);
    expect(res.headers.get('vary')).toMatch(/Authorization/i);
  });

  it('an unknown place is a 404; a place with no ad is `{ ad: null }`', async () => {
    await seed();
    expect((await get('/api/ads/public_pages')).status).toBe(404);
    expect((await get('/api/ads/nonsense')).status).toBe(404);
    expect(await (await get('/api/ads/mart_banner')).json()).toEqual({ ad: null });
  });

  it('a database that is down is `{ ad: null }`, never an error page on somebody\'s screen', async () => {
    await seed();
    setServerDb(null);
    const res = await get('/api/ads/mart_tile');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ad: null });
  });

  it('a signed-in user whose wallet cannot be read gets no ad', async () => {
    await seed();
    const real = db.doc;
    (db as any).doc = (p: string) => (p.startsWith('user_token_wallets/') ? { get: async () => { throw new Error('down'); } } : real(p));
    forgetPublicAds();
    expect(await (await get('/api/ads/mart_tile', 'Bearer free')).json()).toEqual({ ad: null });
  });

  it('serves the picture with the right type, a long cache lifetime, nosniff and a locked-down CSP', async () => {
    const id = await seed();
    const res = await get(`/api/ads/image/${id}?v=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toMatch(/immutable/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('a picture request for an id that is not an ad is a 404 and never reaches the database', async () => {
    await seed();
    const before = db.reads;
    expect((await get('/api/ads/image/..%2F..%2Fusers%2Fx')).status).toBe(404);
    expect((await get('/api/ads/image/not-an-id')).status).toBe(404);
    expect(db.reads).toBe(before);
    expect((await get('/api/ads/image/ad_dddddddddddd')).status).toBe(404);
  });
});

describe('the admin routes are all behind the admin token', () => {
  const ADMIN = readFileSync(join(__dirname, '../src/server/routes/admin.ts'), 'utf8');

  it('every /api/admin/ads registration names verifyAdminToken, and audits its write', () => {
    const regs = [...ADMIN.matchAll(/app\.(get|post|put|delete)\('\/api\/admin\/ads[^']*',([^\n]*)/g)];
    expect(regs.map((m) => m[1]).sort()).toEqual(['delete', 'get', 'post', 'put']);
    for (const m of regs) expect(m[2], `${m[1]}`).toContain('verifyAdminToken');
    for (const ev of ['ADMIN_HOUSE_AD_CREATED', 'ADMIN_HOUSE_AD_UPDATED', 'ADMIN_HOUSE_AD_DELETED']) expect(ADMIN).toContain(`audit('${ev}'`);
  });

  it('the public routes never read an admin token and never write', () => {
    const PUBLIC = readFileSync(join(__dirname, '../src/server/routes/houseAds.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(PUBLIC).not.toMatch(/verifyAdminToken|x-admin-token/);
    expect(PUBLIC).not.toMatch(/\bsetDoc\b|\bupdateDoc\b|\bdeleteDoc\b|app\.(post|put|delete|patch)\(/);
  });
});
