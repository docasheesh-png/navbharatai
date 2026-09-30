/**
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
import {
  imageTierOf, freeBusyMessage, editNeedsPaidMessage, FREE_BUSY_CODE, NEEDS_PAID_CODE,
} from '../src/server/lib/imageTier';
import {
  imageProConfigured, imageProAuthHeaders, parseImageProResponse, pendingResultUrl, jobFailed,
  fetchImageProHostImage, buildImageProTextRequest,
} from '../src/server/lib/imageProHost';
import { paidCanAnswer } from '../src/lib/imageAllowanceLine';
import { resetAnonymousDoor, noteAnonymousResult } from '../src/server/lib/freeProviderDoor';

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
describe('which mode a request is for', () => {
  it('only the word "paid" is Paid; everything else — an installed phone app sends nothing — is Free', () => {
    expect(imageTierOf({ tier: 'paid' })).toBe('paid');
    expect(imageTierOf({ tier: ' PAID ' })).toBe('paid');
    for (const t of [undefined, null, 'free', 'pro', 'Paid-please', 1, true]) expect(imageTierOf({ tier: t })).toBe('free');
    expect(imageTierOf(null)).toBe('free');
  });

  it('the screen offers the switch only for the two codes Paid mode can answer', () => {
    expect(paidCanAnswer({ code: FREE_BUSY_CODE })).toBe('free_busy');
    expect(paidCanAnswer({ code: NEEDS_PAID_CODE })).toBe('needs_paid');
    expect(paidCanAnswer({ code: 'wallet_empty' })).toBe('');
    expect(paidCanAnswer({ code: 'blocked' })).toBe('');
    expect(paidCanAnswer(null)).toBe('');
  });
});

describe('"the free servers are busy — try Paid", in the user\'s own language', () => {
  it('English for English', () => {
    expect(freeBusyMessage('a red car on a hill')).toMatch(/^The free image servers are too busy right now\. Please try Paid mode/);
    expect(editNeedsPaidMessage('make the sky blue')).toMatch(/Paid mode/);
  });

  it('Devanagari Hindi, Tamil and Bengali prompts get their own script', () => {
    expect(freeBusyMessage('पहाड़ पर लाल कार की फ़ोटो')).toMatch(/^फ़्री इमेज सर्वर अभी बहुत व्यस्त हैं/);
    expect(freeBusyMessage('மலையில் சிவப்பு கார்')).toMatch(/^இலவச படச் சேவையகங்கள்/);
    expect(freeBusyMessage('পাহাড়ে লাল গাড়ি')).toMatch(/^ফ্রি ইমেজ সার্ভার/);
    expect(editNeedsPaidMessage('आसमान नीला कर दो')).toMatch(/^अपनी फ़ोटो बदलना Paid मोड में होता है/);
  });

  it('Roman Hindi gets Roman Hindi — but one shared English word is not enough', () => {
    expect(freeBusyMessage('ek sher ki photo banao')).toMatch(/^Free image server abhi bahut busy hain/);
    expect(freeBusyMessage('photo of a banner')).toMatch(/^The free image servers/);
  });

  it('every language names Paid mode in the Latin word the toggle shows', () => {
    for (const p of ['a car', 'ek car ki photo banao', 'लाल कार', 'சிவப்பு கார்', 'ಕೆಂಪು ಕಾರು', 'लाल गाड़ी चाहिए', 'سرخ گاڑی']) {
      expect(freeBusyMessage(p), p).toContain('Paid');
      expect(editNeedsPaidMessage(p), p).toContain('Paid');
    }
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
    process.env.IMAGE_GEN_ANON_PROBE = 'off';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc1';
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
    resetAnonymousDoor();
    usage.used = 0; usage.increments = 0;
    money.balance = 100; money.debits = [];
    fetchSpy = vi.fn(async () => new Response('down', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetAnonymousDoor();
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

  it('Free mode is free for everybody: a link from the user\'s own connection, nothing counted, nothing charged', async () => {
    usage.used = 50;
    money.balance = 0;
    const res = await generate(body);
    expect(res.statusCode).toBe(200);
    expect(res.body.mode).toBe('client-fetch');
    expect(fetchSpy).not.toHaveBeenCalled(); // not even Cloudflare: Free mode is the free provider only
    expect(usage.increments).toBe(0);
    expect(money.debits).toEqual([]);
  });

  it('Free mode, free provider refusing: the user\'s language, the Paid pointer, and no paid engine spent', async () => {
    process.env.GROK_API_KEY = 'xai-test';
    process.env.IMAGE_PRO_KEY = 'k1';
    process.env.IMAGE_PRO_ENDPOINT = 'https://host.example/run';
    noteAnonymousResult('HTTP 401');
    const res = await generate({ ...body, prompt: 'पहाड़ पर लाल कार' });
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe(FREE_BUSY_CODE);
    expect(res.body.error).toMatch(/^फ़्री इमेज सर्वर अभी बहुत व्यस्त हैं/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(usage.increments).toBe(0);
  });

  it('Free mode, an edit of the user\'s own photo: pointed at Paid mode before anything is called', async () => {
    const res = await generate({ ...body, prompt: 'ek sher ki photo banao aur background badlo', initImage: `data:image/png;base64,${PNG}` });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe(NEEDS_PAID_CODE);
    expect(res.body.error).toMatch(/^Apni photo badalna Paid mode me hota hai/);
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

  it('Paid mode never hands out a link, even when the free provider\'s door is open', async () => {
    process.env.CLOUDFLARE_API_TOKEN = '';
    const res = await generate({ ...body, tier: 'paid' });
    expect(res.body.mode).toBeUndefined();
    expect(res.body.url).toBeUndefined();
    expect(res.statusCode).toBe(502);
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
