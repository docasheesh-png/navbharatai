/**
 * Ten free messages a day without signing in — all surfaces together — then sign in or come back
 * tomorrow (admin 2026-09-27, verbatim: "without login only 10 messages per day! iske bad login
 * compulsory!! 11th message login ke bad ya next day! sabhi mila kar!!").
 *
 * Before this, the only "10 a day" rule was a counter in the browser's localStorage that counted free
 * chat alone — clearing site data reset it — and free chat did not even send the signed-in user's token,
 * so the server could not have told a visitor from an account had it tried.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Request, Response } from 'express';
import {
  guestDailyQuota, decideGuestMessage, guestDailyLimit, guestDailyIpCap, indiaDay, readGuestId,
  requestAddress, guestLimitMessage, GUEST_LIMIT_CODE, type GuestUsageStore, type GuestBudgetState,
} from '../src/server/lib/guestDailyQuota';
import { guestLimitReached, GUEST_LIMIT_CODE as CLIENT_CODE, GUEST_ID_HEADER as CLIENT_HEADER } from '../src/lib/guestId';
import { corsMiddleware } from '../src/server/lib/cors';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const DEVICE = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

/** An in-memory store with the production store's semantics: decide, then count only an allowed message. */
function memoryStore(): GuestUsageStore & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    async consume(day, deviceKey, ipKey, decide) {
      const state: GuestBudgetState = {
        deviceUsed: deviceKey ? counts.get(`${day}:dev:${deviceKey}`) ?? 0 : null,
        ipUsed: counts.get(`${day}:ip:${ipKey}`) ?? 0,
      };
      const d = decide(state);
      if (d.allow) {
        counts.set(`${day}:ip:${ipKey}`, state.ipUsed + 1);
        if (deviceKey) counts.set(`${day}:dev:${deviceKey}`, (state.deviceUsed ?? 0) + 1);
      }
      return d;
    },
  };
}

function fakeReq(headers: Record<string, string> = {}): Request {
  return { headers: { 'x-forwarded-for': '203.0.113.9', ...headers }, socket: { remoteAddress: '10.0.0.1' } } as unknown as Request;
}
function fakeRes() {
  const r = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    setHeader: (k: string, v: string) => { r.headers[k] = v; },
    status: (c: number) => { r.statusCode = c; return res; },
    json: (b: unknown) => { r.body = b; return res; },
  };
  return { res: res as unknown as Response, r };
}

/** Send one message through a surface; true when it reached the handler. */
async function send(mw: ReturnType<typeof guestDailyQuota>, req: Request) {
  const { res, r } = fakeRes();
  const next = vi.fn();
  await mw(req, res, next);
  return { passed: next.mock.calls.length === 1, r };
}

const NOW = Date.parse('2026-09-27T10:00:00Z'); // 15:30 in India

describe('the rule', () => {
  it('🔴 ten messages go through, the eleventh is refused with a sign-in code', async () => {
    const store = memoryStore();
    const mw = guestDailyQuota('chat', { store, identify: async () => null, now: () => NOW, env: {} });
    for (let i = 1; i <= 10; i++) expect((await send(mw, fakeReq({ 'x-nb-guest': DEVICE }))).passed, `message ${i}`).toBe(true);
    const eleventh = await send(mw, fakeReq({ 'x-nb-guest': DEVICE }));
    expect(eleventh.passed).toBe(false);
    expect(eleventh.r.statusCode).toBe(403);
    expect(eleventh.r.body).toMatchObject({ code: GUEST_LIMIT_CODE, limit: 10 });
    expect(String((eleventh.r.body as { error: string }).error)).toMatch(/Sign in to keep going/);
  });

  it('🔴 "sabhi mila kar": the ten are shared by every surface, not ten each', async () => {
    const store = memoryStore();
    const deps = { store, identify: async () => null, now: () => NOW, env: {} };
    const surfaces = ['chat', 'repo-analyst', 'app-review', 'security-scan', 'debug'].map((s) => guestDailyQuota(s, deps));
    for (let i = 0; i < 10; i++) expect((await send(surfaces[i % surfaces.length], fakeReq({ 'x-nb-guest': DEVICE }))).passed).toBe(true);
    for (const mw of surfaces) expect((await send(mw, fakeReq({ 'x-nb-guest': DEVICE }))).passed).toBe(false);
  });

  it('🔴 a signed-in account is never counted and never refused', async () => {
    const store = memoryStore();
    const consume = vi.spyOn(store, 'consume');
    const mw = guestDailyQuota('chat', { store, identify: async () => ({ uid: 'u1' }), now: () => NOW, env: {} });
    for (let i = 0; i < 25; i++) expect((await send(mw, fakeReq({ 'x-nb-guest': DEVICE }))).passed).toBe(true);
    expect(consume).not.toHaveBeenCalled();
  });

  it('🔴 the eleventh goes through the next day (India\'s midnight)', async () => {
    const store = memoryStore();
    let now = Date.parse('2026-09-27T18:29:00Z'); // 23:59 in India
    const mw = guestDailyQuota('chat', { store, identify: async () => null, now: () => now, env: {} });
    for (let i = 0; i < 10; i++) await send(mw, fakeReq({ 'x-nb-guest': DEVICE }));
    expect((await send(mw, fakeReq({ 'x-nb-guest': DEVICE }))).passed).toBe(false);
    now = Date.parse('2026-09-27T18:31:00Z'); // 00:01 next day in India
    expect((await send(mw, fakeReq({ 'x-nb-guest': DEVICE }))).passed).toBe(true);
  });

  it('a different device on the same mobile address has its own ten (CGNAT)', async () => {
    const store = memoryStore();
    const mw = guestDailyQuota('chat', { store, identify: async () => null, now: () => NOW, env: {} });
    for (let i = 0; i < 10; i++) await send(mw, fakeReq({ 'x-nb-guest': DEVICE }));
    const other = '9f1c2d3e-4a5b-4c6d-8e7f-001122334455';
    expect((await send(mw, fakeReq({ 'x-nb-guest': other }))).passed).toBe(true);
  });

  it('a script minting a fresh device id per message still stops at the address backstop', async () => {
    const store = memoryStore();
    const mw = guestDailyQuota('chat', { store, identify: async () => null, now: () => NOW, env: {} });
    let passed = 0;
    for (let i = 0; i < 150; i++) {
      const id = `device-${String(i).padStart(12, '0')}`;
      if ((await send(mw, fakeReq({ 'x-nb-guest': id }))).passed) passed++;
    }
    expect(passed).toBe(100);
  });

  it('a counter that cannot be read lets the message through (fail open) — never locks visitors out', async () => {
    const store: GuestUsageStore = { consume: async () => { throw new Error('firestore down'); } };
    const mw = guestDailyQuota('chat', { store, identify: async () => null, now: () => NOW, env: {} });
    expect((await send(mw, fakeReq({ 'x-nb-guest': DEVICE }))).passed).toBe(true);
  });

  it('GUEST_DAILY_MESSAGES: unset ⇒ 10, `off` ⇒ no limit, `0` ⇒ sign-in first, unreadable ⇒ 10 (never unlimited)', () => {
    expect(guestDailyLimit({})).toBe(10);
    expect(guestDailyLimit({ GUEST_DAILY_MESSAGES: 'off' })).toBeNull();
    expect(guestDailyLimit({ GUEST_DAILY_MESSAGES: '0' })).toBe(0);
    expect(guestDailyLimit({ GUEST_DAILY_MESSAGES: '15' })).toBe(15);
    for (const bad of ['ten', '-1', '2.5', '10%']) expect(guestDailyLimit({ GUEST_DAILY_MESSAGES: bad })).toBe(10);
    expect(decideGuestMessage({ deviceUsed: 0, ipUsed: 0 }, 0, 100)).toEqual({ allow: false, reason: 'signin-only' });
    expect(guestLimitMessage(0)).toMatch(/sign in/i);
  });

  it('the backstop is never smaller than the per-device limit', () => {
    expect(guestDailyIpCap({}, 10)).toBe(100);
    expect(guestDailyIpCap({ GUEST_DAILY_IP_CAP: '5' }, 10)).toBe(10);
    expect(guestDailyIpCap({ GUEST_DAILY_IP_CAP: 'lots' }, 10)).toBe(100);
  });
});

describe('the parts', () => {
  it('the day is India\'s calendar day', () => {
    expect(indiaDay(Date.parse('2026-09-27T18:29:59Z'))).toBe('2026-09-27');
    expect(indiaDay(Date.parse('2026-09-27T18:30:00Z'))).toBe('2026-09-28');
  });

  it('only an id shaped like one the app mints is read; anything else is ignored', () => {
    expect(readGuestId(DEVICE)).toBe(DEVICE);
    for (const bad of ['', 'short', 'has space in it here', '<script>alert(1)</script>', 'x'.repeat(80)]) expect(readGuestId(bad)).toBeNull();
  });

  it('the address is the LAST forwarded entry — the one Cloud Run appends, not the one a caller claims', () => {
    expect(requestAddress({ headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }, socket: {} } as never)).toBe('203.0.113.9');
    expect(requestAddress({ headers: {}, socket: { remoteAddress: '10.0.0.1' } } as never)).toBe('10.0.0.1');
  });
});

describe('the client', () => {
  it('client and server agree on the header and the code', () => {
    expect(CLIENT_CODE).toBe(GUEST_LIMIT_CODE);
    expect(CLIENT_HEADER).toBe('x-nb-guest');
  });

  it('recognises the refusal and hands back the sentence to show', async () => {
    const res = new Response(JSON.stringify({ code: GUEST_LIMIT_CODE, error: 'come back tomorrow' }), { status: 403 });
    expect(await guestLimitReached(res)).toBe('come back tomorrow');
    expect(await guestLimitReached(new Response('{}', { status: 403 }))).toBeNull();
    expect(await guestLimitReached(new Response('{}', { status: 500 }))).toBeNull();
  });

  it('🔴 free chat sends the account token now — without it every signed-in user would be counted as a guest', () => {
    const engine = read('src/hooks/useChatEngine.ts');
    expect(engine).toMatch(/const headers: Record<string, string> = \{ 'Content-Type': 'application\/json', \.\.\.\(await authHeader\(\)\) \};/);
    expect(engine.match(/\.\.\.\(await authHeader\(\)\)/g)?.length).toBe(2);
  });

  it('the refusal is read BEFORE the 401 branch that signs the user out', () => {
    const engine = read('src/hooks/useChatEngine.ts');
    const guest = engine.indexOf('const guestLimit = await guestLimitReached(response);');
    const signOut = engine.indexOf('if (response.status === 401) {', guest - 400);
    expect(guest).toBeGreaterThan(0);
    expect(signOut).toBeGreaterThan(guest);
  });

  it('🔴 the browser-only counter is gone — the server is the one count', () => {
    for (const f of ['src/hooks/useChatEngine.ts', 'src/hooks/usePaymentEngine.ts', 'src/App.tsx']) {
      expect(read(f), f).not.toMatch(/isFreeLimitReached|FREE_DAILY_MESSAGES/);
    }
  });

  it('the native app can send the header — CORS reflects it on the preflight', () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { headers[k] = v; }, status: () => ({ end: () => {} }) };
    corsMiddleware()(
      { method: 'OPTIONS', headers: { origin: 'https://localhost', 'access-control-request-headers': 'content-type, x-nb-guest' } },
      res, () => {},
    );
    expect(headers['Access-Control-Allow-Headers']).toMatch(/x-nb-guest/);
  });

  it('the privacy policy says what the guest identifier is', () => {
    const policy = read('src/content/legal/privacyPolicy.ts');
    expect(policy).toMatch(/random guest identifier/);
    expect(policy).toMatch(/only while you are signed out/);
  });
});

describe('every AI route a signed-out visitor can reach carries the budget', () => {
  /** The census. A new anonymous AI route belongs here — and then fails until it carries the budget. */
  const ROUTES: Array<[string, string]> = [
    ['src/server/routes/chat.ts', "app.post('/api/chat/navbharat',"],
    ['src/server/routes/chat.ts', "app.post('/api/chat/navbharatai',"],
    ['src/server/routes/repoAnalyst.ts', "app.post('/api/repo-analyst/chat',"],
    ['src/server/routes/repoAnalyst.ts', "app.post('/api/repo-analyst/generate',"],
    ['src/server/routes/appReview.ts', "app.post('/api/app-review/review',"],
    ['src/server/routes/audit.ts', "app.post('/api/security/scan',"],
    ['src/server/routes/debug.ts', "app.post('/api/debug',"],
    ['src/server/routes/appDebug.ts', "app.post('/api/app-debug/run',"],
    ['src/server/routes/appDebug.ts', "app.post('/api/app-debug/investigate',"],
    ['src/server/routes/design.ts', "app.post('/api/design/suggest',"],
    ['src/server/routes/design.ts', "app.post('/api/design/palette',"],
  ];
  for (const [file, route] of ROUTES) {
    it(`${route.replace("app.post('", '').replace("',", '')}`, () => {
      const src = read(file);
      const at = src.indexOf(route);
      expect(at, `${route} not found in ${file}`).toBeGreaterThan(-1);
      const line = src.slice(at, src.indexOf('\n', at));
      expect(line).toMatch(/guestDailyQuota\('/);
    });
  }
});
