// "image banne band ho gaye hai!!" (admin, 2026-09-30).
//
// The free image provider closed its anonymous endpoint (401 without an account key). Our free tier
// handed the BROWSER a link to that endpoint, so every free picture failed, and the bundled phone apps
// had no way back to the server's paid rungs. These tests lock both halves of the fix:
//  1. the server notices a closed door (from its own fetch, a probe, or a new client's report) and stops
//     minting links to it — the request then reaches the metered paid rungs and even an old client gets
//     the picture bytes;
//  2. with `POLLINATIONS_API_KEY` the picture is fetched HERE, the key in a header and never in a link.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import {
  isAuthFailure, noteAnonymousResult, anonymousDoorOpen, anonymousDoorNote, probeAnonymousDoor,
  checkAnonymousDoor, newDoorState, resetAnonymousDoor, CLOSED_FOR_MS, PROBE_EVERY_MS, PROBE_URL,
} from '../src/server/lib/freeProviderDoor';
import { pollinationsKeyedUrl, pollinationsApiKey, fetchPollinationsImage } from '../src/server/lib/imageGen';

process.env.VITEST = 'true';

vi.mock('../src/server/lib/costlyAiAccess', () => ({
  requireAccountForCostlyAi: async () => ({ ok: true, uid: 'u1', email: 'u1@example.com' }),
}));
vi.mock('../src/server/tools/toolGate', () => ({
  gateToolAction: async () => ({ allow: true, uid: 'u1', countsAgainstFree: false, isFreeListed: true }),
  burnToolAction: () => undefined,
}));

const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } });

describe('only an AUTH refusal closes the door', () => {
  it('401, 402 and 403 are refusals; a slow, busy or broken provider is not', () => {
    for (const r of ['HTTP 401', 'HTTP 402', 'HTTP 403']) expect(isAuthFailure(r)).toBe(true);
    for (const r of ['HTTP 400', 'HTTP 429', 'HTTP 500', 'HTTP 503', 'timeout', 'link did not load', 'retry budget spent', null, undefined])
      expect(isAuthFailure(r as string)).toBe(false);
  });

  it('a refusal closes it for CLOSED_FOR_MS, and it opens again after', () => {
    const s = newDoorState();
    expect(anonymousDoorOpen(1000, s)).toBe(true);
    expect(noteAnonymousResult('HTTP 429', 1000, s)).toBe(false);
    expect(anonymousDoorOpen(1000, s)).toBe(true);
    expect(noteAnonymousResult('HTTP 401', 1000, s)).toBe(true);
    expect(anonymousDoorOpen(1001, s)).toBe(false);
    expect(anonymousDoorNote(1001, s)).toMatch(/POLLINATIONS_API_KEY/);
    expect(anonymousDoorOpen(1000 + CLOSED_FOR_MS, s)).toBe(true);
    expect(anonymousDoorNote(1000 + CLOSED_FOR_MS, s)).toBeNull();
  });
});

describe('the probe finds out on its own', () => {
  it('a 401 closes the door; a picture reopens it; a network error changes nothing', async () => {
    const s = newDoorState();
    await probeAnonymousDoor(async () => ({ status: 401 }), s, () => 5000);
    expect(anonymousDoorOpen(5001, s)).toBe(false);
    await probeAnonymousDoor(async () => { throw new Error('ECONNRESET'); }, s, () => 6000);
    expect(anonymousDoorOpen(6001, s)).toBe(false);
    await probeAnonymousDoor(async () => ({ status: 200 }), s, () => 7000);
    expect(anonymousDoorOpen(7001, s)).toBe(true);
    await probeAnonymousDoor(async () => ({ status: 503 }), s, () => 8000);
    expect(anonymousDoorOpen(8001, s)).toBe(true);
  });

  it('asks for the smallest picture, anonymously', async () => {
    const seen: string[] = [];
    await probeAnonymousDoor(async (u) => { seen.push(u); return { status: 200 }; }, newDoorState(), () => 1);
    expect(seen).toEqual([PROBE_URL]);
    expect(PROBE_URL).toMatch(/width=64&height=64/);
    expect(PROBE_URL).not.toMatch(/key=/);
  });

  it('the first check on an instance waits for the probe; the next one inside PROBE_EVERY_MS does not probe', async () => {
    const s = newDoorState();
    let t = 1_000_000;
    const f = vi.fn(async () => ({ status: 401 }));
    const env = { IMAGE_GEN_ANON_PROBE: 'on' } as NodeJS.ProcessEnv;
    expect(await checkAnonymousDoor({ fetchImpl: f, state: s, now: () => t, env })).toBe(false);
    t += PROBE_EVERY_MS - 1;
    expect(await checkAnonymousDoor({ fetchImpl: f, state: s, now: () => t, env })).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('a first probe that hangs never holds the user longer than the wait', async () => {
    const s = newDoorState();
    const started = Date.now();
    const open = await checkAnonymousDoor({ fetchImpl: () => new Promise(() => {}), state: s, env: {} as NodeJS.ProcessEnv, firstWaitMs: 50 });
    expect(open).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('IMAGE_GEN_ANON_PROBE=off makes no call at all', async () => {
    const f = vi.fn(async () => ({ status: 401 }));
    expect(await checkAnonymousDoor({ fetchImpl: f, state: newDoorState(), env: { IMAGE_GEN_ANON_PROBE: 'off' } as NodeJS.ProcessEnv })).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('the account key never leaves this server', () => {
  const env = { POLLINATIONS_API_KEY: '  sk_secret_123  ' } as NodeJS.ProcessEnv;

  it('is read trimmed, and the keyed link carries no key', () => {
    expect(pollinationsApiKey(env)).toBe('sk_secret_123');
    const url = pollinationsKeyedUrl('a red camera', 'square', env);
    expect(url.startsWith('https://gen.pollinations.ai/image/')).toBe(true);
    expect(url).not.toContain('sk_secret');
    expect(url).toContain('safe=true');
  });

  it('the keyed link runs the same word guard as the anonymous one', () => {
    expect(() => pollinationsKeyedUrl('nude woman', 'square', env)).toThrow();
  });

  it('the fetch sends the key as a header to the keyed endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const r = await fetchPollinationsImage('a red camera', 'square', {
      env,
      fetchImpl: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return png(); }) as unknown as typeof fetch,
    });
    expect(r.image).toBeTruthy();
    expect(calls[0].url).toMatch(/^https:\/\/gen\.pollinations\.ai\/image\//);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk_secret_123');
  });

  it('without a key, the anonymous link, with no Authorization header', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await fetchPollinationsImage('a red camera', 'square', {
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return png(); }) as unknown as typeof fetch,
    });
    expect(calls[0].url).toMatch(/^https:\/\/image\.pollinations\.ai\/prompt\//);
    expect(calls[0].init.headers).toBeUndefined();
  });
});

describe('the real route', () => {
  const saved = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GROK_API_KEY', 'XAI_API_KEY',
      'IMAGE_GEN_POLLINATIONS', 'IMAGE_GEN_CLIENT_FETCH', 'POLLINATIONS_API_KEY']) delete process.env[k];
    process.env.SECRET_ENCRYPTION_KEY = 'route-secret';
    process.env.IMAGE_GEN_ANON_PROBE = 'off';
    // The test account is free-listed, as the mocked tool gate always said: its images are neither
    // counted against the platform's paid-image day nor charged.
    process.env.AGENTV3_FREE_LIST = 'u1@example.com';
    for (const k of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AI_TOKEN']) delete process.env[k];
    resetAnonymousDoor();
    fetchSpy = vi.fn(async (url: string) => {
      if (String(url).startsWith('https://api.x.ai/')) {
        return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgo=' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (String(url).startsWith('https://image.pollinations.ai/')) return new Response('need a key', { status: 401 });
      return png();
    });
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...saved };
    resetAnonymousDoor();
  });

  async function generate(body: Record<string, unknown>) {
    const { registerImageGenRoutes } = await import('../src/server/routes/imageGen');
    const routes = captureRoutes(registerImageGenRoutes);
    const res = mockRes();
    await routes.get('POST /api/image/generate')!(mockReq({ body }), res);
    return res;
  }
  const body = { prompt: 'make a camera', style: 'photo', size: 'square', type: 'Photograph' };

  it('while the door is open, the browser still gets a link (today\'s behaviour, unchanged)', async () => {
    const res = await generate(body);
    expect(res.body.mode).toBe('client-fetch');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // 🔁 2026-09-30, later the same day (admin: "free wala sabhi ke liye free, agar pollination se image
  // na bane, to likh kar aye, free server are too busy try on paid service"). Free mode no longer falls
  // through to a paid engine: a closed door is an honest sentence pointing at Paid mode, in the user's
  // language — and still never a dead link, which is what this file was written against.
  it('a new client reporting HTTP 401 closes the door, and the NEXT user — an old phone app — gets the honest answer, not a dead link', async () => {
    process.env.GROK_API_KEY = 'xai-test';
    const first = await generate(body);
    await generate({ ...body, freeFailed: { url: first.body.url, ticket: first.body.ticket, exp: first.body.exp, reason: 'HTTP 401' } });
    expect(anonymousDoorOpen()).toBe(false);
    fetchSpy.mockClear();

    const oldClient = await generate(body); // no freeFailed and no tier: the bundled client sends neither
    expect(oldClient.body.mode).toBeUndefined();
    expect(oldClient.body.url).toBeUndefined();
    expect(oldClient.statusCode).toBe(503);
    expect(oldClient.body.code).toBe('free_busy');
    expect(String(oldClient.body.error)).toMatch(/free image servers are too busy.*Paid mode/i);
    expect(fetchSpy).not.toHaveBeenCalled(); // the closed door is not knocked on, and no paid engine is spent
  });

  it('the server\'s own 401 closes the door too', async () => {
    process.env.IMAGE_GEN_CLIENT_FETCH = 'off';
    process.env.GROK_API_KEY = 'xai-test';
    const res = await generate(body);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('free_busy');
    expect(anonymousDoorOpen()).toBe(false);
    const hosts = fetchSpy.mock.calls.map((c) => new URL(String(c[0])).host);
    expect(hosts).not.toContain('api.x.ai');
  });

  it('a closed door is an honest failure, never a link', async () => {
    noteAnonymousResult('HTTP 401');
    const res = await generate(body);
    expect(res.statusCode).toBe(503);
    expect(res.body.url).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Free mode never spends our account key, even when one is set', async () => {
    process.env.POLLINATIONS_API_KEY = 'sk_live_abc';
    process.env.IMAGE_GEN_CLIENT_FETCH = 'off';
    await generate(body);
    for (const [url, init] of fetchSpy.mock.calls as [string, RequestInit | undefined][]) {
      expect(new URL(url).host).not.toBe('gen.pollinations.ai');
      expect(JSON.stringify(init?.headers ?? {})).not.toContain('sk_live_abc');
    }
  });

  it('Paid mode with an account key: no link is minted, the picture is fetched here with the key in a header', async () => {
    process.env.POLLINATIONS_API_KEY = 'sk_live_abc';
    noteAnonymousResult('HTTP 401'); // the anonymous door being shut does not matter with a key
    const res = await generate({ ...body, tier: 'paid' });
    expect(res.body.mode).toBeUndefined();
    expect(res.body.url).toBeUndefined();
    expect(String(res.body.image)).toMatch(/^data:image\/png;base64,/);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).host).toBe('gen.pollinations.ai');
    expect(url).not.toContain('sk_live_abc');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_live_abc');
    expect(JSON.stringify(res.body)).not.toContain('sk_live_abc');
  });
});
