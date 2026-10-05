/**
 * ONE IMAGE GENERATOR SINCE 2026-10-05 — Free mode removed on the admin's word (`imageTier.ts`).
 * The 2026-09-30 two-mode text below is kept as history; the route tests now lock the one-mode rules:
 *  A. Every caller runs the same ladder and counts against the same 5 a day.
 *  B. Only a screen that showed the price (`tier: 'paid'`) is ever charged. A caller that sent no tier
 *     (an installed phone app) gets its free pictures and then a plain sentence — never a charge.
 *  C. No link is ever handed out: the anonymous free door answered 402 to everyone.
 *
 * FREE AND PAID, ON ONE SCREEN (admin 2026-09-30).
 *
 * Admin, verbatim: *"pahle ek system tha, free + paid (dono the) wahi bana do! free wala sabhi ke liye
 * free, agar pollination se image na bane, to likh kar aye, free server are too busy try on paid
 * service (user ki bhasa me). aur paid wala system abhi apne jo banaya hai, aur old paid wala mila ke
 * banao!!"*
 *
 *  1. Free mode is free for everybody: nothing counted, nothing charged, our account key never used.
 *  2. When the free provider cannot make the picture, the answer names Paid mode, in the user's own
 *     language — and no paid engine is spent on it.
 *  3. Paid mode climbs Cloudflare → the keyed free provider → the old Pro host → Gemini → Grok, with the
 *     5-free-then-₹1 allowance (`fiveFreeImagesThenOneRupee.test.ts`).
 *  4. The old Pro host's async answer is polled to the picture, and it is never sent a photograph.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { priceShownTo, freeUsedUpdateMessage, FREE_USED_UPDATE_CODE } from '../src/server/lib/imageTier';
import {
  imageProConfigured, imageProAuthHeaders, parseImageProResponse, pendingResultUrl, jobFailed,
  fetchImageProHostImage, buildImageProTextRequest,
} from '../src/server/lib/imageProHost';

process.env.VITEST = 'true';

const usage = vi.hoisted(() => ({ used: 0, increments: 0 }));
const money = vi.hoisted(() => ({ balance: 100 as number | null, debits: [] as Array<{ uid: string; tx: any }> }));

vi.mock('../src/server/lib/costlyAiAccess', () => ({
  requireAccountForCostlyAi: async () => ({ ok: true, uid: 'u7', email: 'u7@example.com' }),
}));
vi.mock('../src/server/tools/toolGate', () => ({
  gateToolAction: async () => ({ allow: true, uid: 'u7', countsAgainstFree: false, isFreeListed: false, hasActivePass: false, tier: 'paid' }),
  burnToolAction: () => undefined,
}));
vi.mock('../src/server/tools/ToolUsageStore', () => ({
  usageDocId: (u: string, b: string) => `${u}__${b}`,
  toolUsageStore: {
    getTodayCount: async () => usage.used,
    increment: async () => { usage.increments += 1; usage.used += 1; return usage.used; },
  },
}));
vi.mock('../src/server/AgentV3/WalletBalance', () => ({
  readWalletBalanceInr: async () => money.balance,
  firestoreWalletReader: () => ({}),
}));
vi.mock('../src/server/lib/walletDebit', async (orig) => ({
  ...(await orig<typeof import('../src/server/lib/walletDebit')>()),
  debitWalletRolledUp: async (_db: unknown, uid: string, tx: any) => {
    money.debits.push({ uid, tx });
    return { ok: true, tokensDebited: 1, tokenBalance: 0 };
  },
}));
vi.mock('../src/server/lib/serverDb', async (orig) => ({
  ...(await orig<typeof import('../src/server/lib/serverDb')>()),
  getServerDb: () => ({}),
}));

const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('consent to a price', () => {
  it('only the word "paid" — the current screen, which shows the price — may be charged', () => {
    expect(priceShownTo({ tier: 'paid' })).toBe(true);
    expect(priceShownTo({ tier: ' PAID ' })).toBe(true);
    for (const t of [undefined, null, 'free', 'pro', 'Paid-please', 1, true]) expect(priceShownTo({ tier: t })).toBe(false);
    expect(priceShownTo(null)).toBe(false);
  });
});

describe('"today\'s free images are used — update the app", in the user\'s language', () => {
  it('English, Devanagari Hindi and Roman Hindi, each naming the count, the price and the way out', () => {
    expect(freeUsedUpdateMessage('a red car on a hill', 5)).toMatch(/^You have used your 5 free images for today\. To make more \(₹1 each\), update the NavBharatAI app/);
    expect(freeUsedUpdateMessage('पहाड़ पर लाल कार की फ़ोटो', 5)).toMatch(/^आज की 5 फ़्री इमेज हो गई हैं/);
    expect(freeUsedUpdateMessage('ek sher ki photo banao', 3)).toMatch(/^Aaj ki 3 free images ho gayi hain/);
    expect(freeUsedUpdateMessage('photo of a banner', 5)).toMatch(/^You have used/);
  });

  it('🔒 it never calls the cause "busy": the old sentence told every user a reason that was not true', () => {
    for (const p of ['a car', 'ek car ki photo banao', 'लाल कार']) expect(freeUsedUpdateMessage(p, 5)).not.toMatch(/busy|व्यस्त/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the old Pro host, back as a paid rung (words only)', () => {
  const cfg = env({ IMAGE_PRO_KEY: ' k1 ', IMAGE_PRO_ENDPOINT: 'https://host.example/run', IMAGE_PRO_AUTH_SCHEME: 'bearer' });

  it('needs both a key and an endpoint, and IMAGE_PRO_ENABLED=off removes it', () => {
    expect(imageProConfigured(cfg)).toBe(true);
    expect(imageProConfigured(env({ IMAGE_PRO_KEY: 'k' }))).toBe(false);
    expect(imageProConfigured(env({ IMAGE_PRO_ENDPOINT: 'https://h' }))).toBe(false);
    expect(imageProConfigured(env({ IMAGE_PRO_KEY: '  ', IMAGE_PRO_ENDPOINT: 'https://h' }))).toBe(false);
    expect(imageProConfigured(env({ ...cfg, IMAGE_PRO_ENABLED: 'off' } as any))).toBe(false);
  });

  it('the auth header follows the one-word scheme, and the key is trimmed', () => {
    expect(imageProAuthHeaders(cfg)).toEqual({ Authorization: 'Bearer k1' });
    expect(imageProAuthHeaders(env({ IMAGE_PRO_KEY: 'k1' }))).toEqual({ Authorization: 'Key k1' });
    expect(imageProAuthHeaders(env({ IMAGE_PRO_KEY: 'k1', IMAGE_PRO_AUTH_SCHEME: 'x-key' }))).toEqual({ 'x-key': 'k1' });
  });

  it('🔒 the request carries words and a size — never an image field', () => {
    const body = buildImageProTextRequest('a lighthouse', { w: 1280, h: 720 }, cfg);
    expect(body).toMatchObject({ prompt: 'a lighthouse', width: 1280, height: 720, model: 'z-image-turbo', enable_sync_mode: true });
    for (const k of ['image', 'image_url', 'strength']) expect(body).not.toHaveProperty(k);
  });

  it('reads the response shapes the host family uses, and tells pending from failed', () => {
    expect(parseImageProResponse({ data: [{ b64_json: PNG }] })).toEqual({ base64: PNG, mimeType: 'image/png' });
    expect(parseImageProResponse({ code: 200, data: { outputs: ['https://cdn.example/a.png'] } })).toEqual({ url: 'https://cdn.example/a.png' });
    expect(parseImageProResponse({ data: { status: 'processing' } })).toBeNull();
    expect(pendingResultUrl({ code: 5004, data: { status: 'processing', urls: { get: 'https://host.example/r/1' } } })).toBe('https://host.example/r/1');
    expect(pendingResultUrl({ data: { status: 'completed' } })).toBeNull();
    expect(jobFailed({ data: { status: 'failed' } })).toBe(true);
    expect(jobFailed({ data: { status: 'processing' } })).toBe(false);
  });

  it('a 200 that says "processing" is polled to the picture, and the picture is fetched as bytes', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === 'https://host.example/run') {
        return new Response(JSON.stringify({ code: 5004, data: { status: 'processing', urls: { get: 'https://host.example/r/1' } } }), { status: 200 });
      }
      if (url === 'https://host.example/r/1') {
        return new Response(JSON.stringify({ data: { status: 'completed', outputs: ['https://cdn.example/a.png'] } }), { status: 200 });
      }
      return new Response(Buffer.from('png-bytes'), { status: 200, headers: { 'content-type': 'image/png' } });
    });
    const out = await fetchImageProHostImage('a lighthouse', { w: 1024, h: 1024 }, { env: cfg, fetchImpl: fetchImpl as any, pollMs: 1 });
    expect(out.image?.mimeType).toBe('image/png');
    expect(Buffer.from(out.image!.base64, 'base64').toString()).toBe('png-bytes');
    expect(calls).toEqual(['https://host.example/run', 'https://host.example/r/1', 'https://cdn.example/a.png']);
  });

  it('a failed job, an HTTP error and a missing config are errors for the admin line, never a picture', async () => {
    const failed = vi.fn(async (url: string) => url.endsWith('/run')
      ? new Response(JSON.stringify({ data: { status: 'processing', urls: { get: 'https://host.example/r/2' } } }), { status: 200 })
      : new Response(JSON.stringify({ data: { status: 'failed' } }), { status: 200 }));
    expect((await fetchImageProHostImage('x', { w: 64, h: 64 }, { env: cfg, fetchImpl: failed as any, pollMs: 1 })).error).toMatch(/failed/);
    const http = vi.fn(async () => new Response('no', { status: 401 }));
    expect(await fetchImageProHostImage('x', { w: 64, h: 64 }, { env: cfg, fetchImpl: http as any })).toEqual({ error: 'HTTP 401' });
    expect(await fetchImageProHostImage('x', { w: 64, h: 64 }, { env: env({}) })).toEqual({ error: 'not configured' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the real route', () => {
  const saved = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GROK_API_KEY', 'XAI_API_KEY',
      'IMAGE_GEN_POLLINATIONS', 'IMAGE_GEN_CLIENT_FETCH', 'POLLINATIONS_API_KEY', 'AGENTV3_FREE_LIST', 'AI_IMAGE_PRICING',
      'CLOUDFLARE_AI_TOKEN', 'IMAGE_GEN_CLOUDFLARE', 'IMAGE_PRO_KEY', 'IMAGE_PRO_ENDPOINT', 'IMAGE_PRO_AUTH_SCHEME', 'IMAGE_PRO_ENABLED']) delete process.env[k];
    process.env.SECRET_ENCRYPTION_KEY = 'route-secret';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc1';
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
    usage.used = 0; usage.increments = 0;
    money.balance = 100; money.debits = [];
    fetchSpy = vi.fn(async () => new Response('down', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...saved };
  });

  async function generate(body: Record<string, unknown>) {
    const { registerImageGenRoutes } = await import('../src/server/routes/imageGen');
    const routes = captureRoutes(registerImageGenRoutes);
    const res = mockRes();
    await routes.get('POST /api/image/generate')!(mockReq({ body }), res);
    return res;
  }
  const body = { prompt: 'a red car', style: 'photo', size: 'square', type: 'Photograph' };
  const hosts = () => fetchSpy.mock.calls.map((c) => new URL(String(c[0])).host);

  it('🔒 a request with no tier (an installed phone app) runs the ladder and is counted — never handed a link', async () => {
    fetchSpy.mockImplementation(async (url: string) => new URL(String(url)).host === 'api.cloudflare.com'
      ? new Response(JSON.stringify({ result: { image: PNG } }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('down', { status: 500 }));
    const res = await generate(body);
    expect(res.body.mode).toBeUndefined();
    expect(res.body.url).toBeUndefined();
    expect(hosts()[0]).toBe('api.cloudflare.com');
    expect(hosts()).not.toContain('image.pollinations.ai');
  });

  it('🔒 no tier, today\'s free pictures used: a plain sentence in their language, no engine called, no charge — whatever the wallet holds', async () => {
    usage.used = 5;
    money.balance = 100;
    const res = await generate({ ...body, prompt: 'पहाड़ पर लाल कार' });
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe(FREE_USED_UPDATE_CODE);
    expect(res.body.error).toMatch(/^आज की 5 फ़्री इमेज हो गई हैं/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(usage.increments).toBe(0);
    expect(money.debits).toEqual([]);
  });

  it('🔒 the screen that showed the price, past its 5: the same request is served and charged ₹1', async () => {
    usage.used = 5;
    process.env.IMAGE_PRO_KEY = 'k1';
    process.env.IMAGE_PRO_ENDPOINT = 'https://host.example/run';
    fetchSpy.mockImplementation(async (url: string) => String(url) === 'https://host.example/run'
      ? new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 })
      : new Response('down', { status: 500 }));
    const res = await generate({ ...body, tier: 'paid' });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(money.debits.map((d) => d.tx.billedInr)).toEqual([1]);
  });

  it('an edit with no tier is no longer refused as "Paid only": it goes to the edit rung like any other caller', async () => {
    const res = await generate({ ...body, prompt: 'background badlo', initImage: `data:image/png;base64,${PNG}` });
    expect(res.body.code).toBeUndefined();
    // No edit engine is configured in this test, so the answer is the honest "not available".
    expect(res.statusCode).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Paid mode climbs Cloudflare → the keyed free provider → the old Pro host, and the host\'s picture is counted', async () => {
    process.env.POLLINATIONS_API_KEY = 'sk_live_abc';
    process.env.IMAGE_PRO_KEY = 'k1';
    process.env.IMAGE_PRO_ENDPOINT = 'https://host.example/run';
    fetchSpy.mockImplementation(async (url: string) => String(url) === 'https://host.example/run'
      ? new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 })
      : new Response('down', { status: 500 }));
    const res = await generate({ ...body, tier: 'paid' });
    expect(res.statusCode).toBe(200);
    expect(String(res.body.image)).toMatch(/^data:image\/png;base64,/);
    expect(hosts()).toEqual(['api.cloudflare.com', 'gen.pollinations.ai', 'host.example']);
    expect(usage.increments).toBe(1);
  });

  it('Paid mode never hands out a link', async () => {
    process.env.CLOUDFLARE_API_TOKEN = '';
    const res = await generate({ ...body, tier: 'paid' });
    expect(res.body.mode).toBeUndefined();
    expect(res.body.url).toBeUndefined();
    // 🔒 With no engine but the key-less free provider, the server is honestly NOT configured: that door
    // answers 402 to everyone, so it is no engine (`imageGenConfigured`).
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/not configured/);
  });

  it('🔒 a Paid edit never reaches a text-to-image rung — Cloudflare, the keyed provider and the host all stay untouched', async () => {
    process.env.POLLINATIONS_API_KEY = 'sk_live_abc';
    process.env.IMAGE_PRO_KEY = 'k1';
    process.env.IMAGE_PRO_ENDPOINT = 'https://host.example/run';
    const res = await generate({ ...body, tier: 'paid', initImage: `data:image/png;base64,${PNG}` });
    // No edit engine is configured in this test, so the answer is the honest "not available".
    expect(res.statusCode).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
