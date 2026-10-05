// "haan, cloudflare wala bana do. aur per day 5 image free for user, uske bad 1₹/image.
//  image generator ai ke aage se free word hatao" (admin, 2026-09-30).
//
// Three halves, each locked here:
//  1. the allowance: 5 free pictures a day, then ₹1 each, decided before any engine runs and charged
//     only for a picture that was delivered;
//  2. the first rung: FLUX on Cloudflare Workers AI, square pictures only, same word ban;
//  3. the name: "Image Generator AI", no FREE.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import {
  decideImageStart, needsBalance, imageFeeForCount, freeImagesLeft, imageFreePerDay, imagePriceInr,
  imagePricingEnabled, imagePriceSentence, imageNeedsCreditBody,
} from '../src/server/lib/imageAllowance';
import {
  cloudflareImageConfig, cloudflareServesSize, mimeFromBase64, fetchCloudflareImage, cloudflareRunUrl,
  CLOUDFLARE_IMAGE_MODEL_DEFAULT,
} from '../src/server/lib/cloudflareImage';
import { imageAllowanceLine } from '../src/lib/imageAllowanceLine';
import { IMAGE_MODE_NAME } from '../src/components/chat/modePicker';
import { WALLET_EMPTY_CODE } from '../src/server/lib/walletEmptyNotice';

process.env.VITEST = 'true';

const usage = vi.hoisted(() => ({ used: 0, increments: 0 }));
const money = vi.hoisted(() => ({ balance: 100 as number | null, debits: [] as Array<{ uid: string; tx: any }> }));

vi.mock('../src/server/lib/costlyAiAccess', () => ({
  requireAccountForCostlyAi: async () => ({ ok: true, uid: 'u9', email: 'u9@example.com' }),
}));
vi.mock('../src/server/tools/toolGate', () => ({
  gateToolAction: async () => ({ allow: true, uid: 'u9', countsAgainstFree: false, isFreeListed: false, hasActivePass: false, tier: 'paid' }),
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

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const JPEG = '/9j/4AAQSkZJRgABAQ==';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. THE ALLOWANCE
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('5 free images a day, then ₹1 each', () => {
  const base = { freeListed: false, freePerDay: 5, priceInr: 1 };

  it('the first five start free, whatever the balance', () => {
    for (const usedToday of [0, 1, 4]) {
      expect(decideImageStart({ ...base, usedToday, balanceInr: 0 })).toEqual({ allow: true, free: true });
    }
  });

  it('the sixth needs ₹1 in the wallet — and is refused with the top-up code when it is not there', () => {
    expect(decideImageStart({ ...base, usedToday: 5, balanceInr: 1 })).toEqual({ allow: true, free: false });
    const refused = decideImageStart({ ...base, usedToday: 5, balanceInr: 0.4 });
    expect(refused.allow).toBe(false);
    if (!refused.allow) {
      expect(refused.status).toBe(402);
      expect(refused.body.code).toBe(WALLET_EMPTY_CODE);
      expect(String(refused.body.error)).toMatch(/used your 5 free images for today/);
      expect(String(refused.body.error)).toMatch(/costs ₹1 from your wallet/);
      expect(String(refused.body.error)).toMatch(/₹0\.40/);
    }
  });

  it('an unreadable balance is let through, like every wallet gate here', () => {
    expect(decideImageStart({ ...base, usedToday: 9, balanceInr: null })).toEqual({ allow: true, free: false });
  });

  it('free-listed accounts and a ₹0 price are never refused', () => {
    expect(decideImageStart({ ...base, freeListed: true, usedToday: 99, balanceInr: 0 }).allow).toBe(true);
    expect(decideImageStart({ ...base, priceInr: 0, usedToday: 99, balanceInr: 0 }).allow).toBe(true);
  });

  it('the balance is read only once the free pictures are used up', () => {
    expect(needsBalance({ ...base, usedToday: 4 })).toBe(false);
    expect(needsBalance({ ...base, usedToday: 5 })).toBe(true);
    expect(needsBalance({ ...base, freeListed: true, usedToday: 5 })).toBe(false);
  });

  it('the charge is decided from the count AFTER the picture: 1–5 free, 6th on ₹1, an unwritten count free', () => {
    expect([1, 2, 3, 4, 5].map((n) => imageFeeForCount(n, 5, 1))).toEqual([0, 0, 0, 0, 0]);
    expect(imageFeeForCount(6, 5, 1)).toBe(1);
    expect(imageFeeForCount(40, 5, 1)).toBe(1);
    expect(imageFeeForCount(0, 5, 1)).toBe(0);
    expect(freeImagesLeft(2, 5)).toBe(3);
    expect(freeImagesLeft(9, 5)).toBe(0);
  });

  it('settings: defaults, malformed values fall back, a price is capped, off is the switch', () => {
    expect(imageFreePerDay({} as NodeJS.ProcessEnv)).toBe(5);
    expect(imagePriceInr({} as NodeJS.ProcessEnv)).toBe(1);
    expect(imageFreePerDay({ AI_IMAGE_FREE_PER_DAY: 'lots' } as NodeJS.ProcessEnv)).toBe(5);
    expect(imagePriceInr({ AI_IMAGE_PRICE_INR: 'x' } as NodeJS.ProcessEnv)).toBe(1);
    expect(imagePriceInr({ AI_IMAGE_PRICE_INR: '9999' } as NodeJS.ProcessEnv)).toBe(50);
    expect(imageFreePerDay({ AI_IMAGE_FREE_PER_DAY: '10' } as NodeJS.ProcessEnv)).toBe(10);
    expect(imagePricingEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(imagePricingEnabled({ AI_IMAGE_PRICING: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('every AI that points at the generator states the same rule', () => {
    // Two modes since 2026-09-30 (later the same day): Free for everyone, and Paid with this allowance.
    // One mode since 2026-10-05: the sentence every AI quotes names no Free/Paid mode at all.
    expect(imagePriceSentence({} as NodeJS.ProcessEnv)).toBe('5 free images a day, then ₹1 each from the wallet');
    expect(imagePriceSentence({ AI_IMAGE_PRICING: 'off' } as NodeJS.ProcessEnv)).toBe('free');
    expect(read('src/server/lib/freeChatModeGuide.ts')).toMatch(/imagePriceSentence\(\)/);
    expect(read('src/server/lib/imageIntent.ts')).toMatch(/imagePriceSentence\(\)/);
  });

  it('a refusal names no engine (white-label)', () => {
    const body = JSON.stringify(imageNeedsCreditBody({ freePerDay: 5, priceInr: 1, balanceInr: 0 })).toLowerCase();
    for (const bad of ['cloudflare', 'flux', 'pollinations', 'gemini', 'grok']) expect(body).not.toContain(bad);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. THE CLOUDFLARE RUNG
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FLUX on Cloudflare Workers AI', () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: 'acc1', CLOUDFLARE_API_TOKEN: 'dns-token' } as NodeJS.ProcessEnv;

  it('is configured from the account id and token Cloud Run already holds; a dedicated AI token wins', () => {
    expect(cloudflareImageConfig(env)).toMatchObject({ accountId: 'acc1', token: 'dns-token', model: CLOUDFLARE_IMAGE_MODEL_DEFAULT, steps: 4 });
    expect(cloudflareImageConfig({ ...env, CLOUDFLARE_AI_TOKEN: ' ai-token ' })?.token).toBe('ai-token');
    expect(cloudflareImageConfig({ ...env, IMAGE_GEN_CLOUDFLARE: 'off' })).toBeNull();
    expect(cloudflareImageConfig({ CLOUDFLARE_API_TOKEN: 't' } as NodeJS.ProcessEnv)).toBeNull();
    expect(cloudflareImageConfig({ ...env, CLOUDFLARE_IMAGE_STEPS: '50' })?.steps).toBe(8);
    expect(cloudflareImageConfig({ ...env, CLOUDFLARE_IMAGE_STEPS: 'many' })?.steps).toBe(4);
  });

  it('makes only 1024×1024, so it serves only that size', () => {
    expect(cloudflareServesSize({ w: 1024, h: 1024 })).toBe(true);
    expect(cloudflareServesSize({ w: 1280, h: 720 })).toBe(false);
    expect(cloudflareServesSize({ w: 512, h: 512 })).toBe(false);
  });

  it('reads the picture type from its bytes', () => {
    expect(mimeFromBase64(JPEG)).toBe('image/jpeg');
    expect(mimeFromBase64('iVBORw0KGgoAAA')).toBe('image/png');
    expect(mimeFromBase64('hello')).toBeNull();
  });

  it('posts the prompt to the model with the token in a header, never in the URL', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const r = await fetchCloudflareImage('a red camera', {
      env,
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ success: true, result: { image: JPEG } }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(r.image).toEqual({ mimeType: 'image/jpeg', base64: JPEG });
    expect(calls[0].url).toBe(cloudflareRunUrl(cloudflareImageConfig(env)!));
    expect(calls[0].url).not.toContain('dns-token');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer dns-token');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ prompt: 'a red camera', steps: 4 });
  });

  it('a refusal or an empty answer is an ordinary rung failure with the reason for the admin', async () => {
    const denied = await fetchCloudflareImage('a red camera', {
      env,
      fetchImpl: (async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'Authentication error' }] }), { status: 403 })) as unknown as typeof fetch,
    });
    expect(denied).toEqual({ error: 'HTTP 403: Authentication error' });
    const empty = await fetchCloudflareImage('a red camera', {
      env,
      fetchImpl: (async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 })) as unknown as typeof fetch,
    });
    expect(empty.error).toBe('no image in response');
  });

  it('runs the same word ban as the free provider', async () => {
    await expect(fetchCloudflareImage('nude woman', { env, fetchImpl: vi.fn() as unknown as typeof fetch })).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. THE REAL ROUTE
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the real route', () => {
  const saved = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GROK_API_KEY', 'XAI_API_KEY',
      'IMAGE_GEN_POLLINATIONS', 'IMAGE_GEN_CLIENT_FETCH', 'POLLINATIONS_API_KEY', 'AGENTV3_FREE_LIST', 'AI_IMAGE_PRICING',
      'CLOUDFLARE_AI_TOKEN', 'IMAGE_GEN_CLOUDFLARE']) delete process.env[k];
    process.env.SECRET_ENCRYPTION_KEY = 'route-secret';
    process.env.IMAGE_GEN_ANON_PROBE = 'off';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc1';
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
    usage.used = 0; usage.increments = 0;
    money.balance = 100; money.debits = [];
    fetchSpy = vi.fn(async (url: string) => {
      if (String(url).startsWith('https://api.cloudflare.com/')) {
        return new Response(JSON.stringify({ success: true, result: { image: JPEG } }), { status: 200 });
      }
      return new Response('no', { status: 500 });
    });
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
  // The allowance and the price are Paid mode's (2026-09-30); Free mode is `imageFreeAndPaid.test.ts`.
  const body = { prompt: 'make a camera', style: 'photo', size: 'square', type: 'Photograph', tier: 'paid' };
  const hosts = () => fetchSpy.mock.calls.map((c) => new URL(String(c[0])).host);

  it('Cloudflare draws first, the picture comes back as bytes, and a free one is counted and not charged', async () => {
    usage.used = 2;
    const res = await generate(body);
    expect(res.statusCode).toBe(200);
    expect(String(res.body.image)).toMatch(/^data:image\/jpeg;base64,/);
    expect(res.body.mode).toBeUndefined();
    expect(hosts()).toEqual(['api.cloudflare.com']);
    expect(usage.increments).toBe(1);
    expect(res.body.freeLeftToday).toBe(2);
    expect(res.body.chargedInr).toBe(0);
    expect(money.debits).toEqual([]);
  });

  it('the sixth picture of the day is charged ₹1 to the wallet, as an image line', async () => {
    usage.used = 5;
    const res = await generate(body);
    expect(res.statusCode).toBe(200);
    expect(res.body.chargedInr).toBe(1);
    expect(res.body.freeLeftToday).toBe(0);
    expect(money.debits).toHaveLength(1);
    expect(money.debits[0]).toMatchObject({ uid: 'u9', tx: { billedInr: 1, feature: 'image', description: 'Image Generator AI' } });
  });

  it('with the free pictures used and under ₹1 in the wallet, it is refused before any engine is called', async () => {
    usage.used = 5;
    money.balance = 0.2;
    const res = await generate(body);
    expect(res.statusCode).toBe(402);
    expect(res.body.code).toBe(WALLET_EMPTY_CODE);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(usage.increments).toBe(0);
  });

  it('a picture that failed is never counted and never charged', async () => {
    usage.used = 7;
    fetchSpy.mockImplementation(async () => new Response('down', { status: 500 }));
    process.env.IMAGE_GEN_POLLINATIONS = 'off';
    const res = await generate(body);
    expect(res.statusCode).toBe(502);
    expect(usage.increments).toBe(0);
    expect(money.debits).toEqual([]);
  });

  it('a non-square size is not sent to Cloudflare, which could not honour it', async () => {
    const res = await generate({ ...body, size: 'wide' });
    expect(hosts()).not.toContain('api.cloudflare.com');
    // No other paid engine is configured here, so the answer is the honest failure — never a free link.
    expect(res.body.mode).toBeUndefined();
    expect(res.statusCode).toBe(502);
  });

  it('a free-listed account is neither counted nor charged', async () => {
    process.env.AGENTV3_FREE_LIST = 'u9@example.com';
    usage.used = 50;
    money.balance = 0;
    const res = await generate(body);
    expect(res.statusCode).toBe(200);
    expect(usage.increments).toBe(0);
    expect(money.debits).toEqual([]);
  });

  it('AI_IMAGE_PRICING=off restores the previous behaviour: nothing counted, nothing charged', async () => {
    process.env.AI_IMAGE_PRICING = 'off';
    usage.used = 50;
    money.balance = 0;
    const res = await generate(body);
    expect(res.statusCode).toBe(200);
    expect(usage.increments).toBe(0);
    expect(money.debits).toEqual([]);
    expect(res.body.freeLeftToday).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. THE NAME AND THE SCREEN
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the name has no FREE, and the screen states the price', () => {
  it('the Mode list and the screen say "Image Generator AI"', () => {
    expect(IMAGE_MODE_NAME).toBe('Image Generator AI');
    expect(read('src/components/ide/AIImageGenerator.tsx')).toMatch(/>Image Generator AI</);
  });

  it('🔒 no client file or AI prompt still calls it "Image Generator AI FREE"', () => {
    for (const f of [
      'src/components/chat/modePicker.ts', 'src/components/chat/ModeButton.tsx', 'src/components/ide/AIImageGenerator.tsx',
      'src/server/lib/freeChatModeGuide.ts', 'src/server/lib/imageIntent.ts', 'src/server/AppContext/AppKnowledgeBase.ts',
    ]) {
      const src = read(f).replace(/\(Until 2026-09-30 it was called \\?"Image Generator AI FREE\\?"/, '');
      expect(src, f).not.toMatch(/Image Generator AI FREE/);
    }
  });

  it('the header line states the rule, then what is left today', () => {
    expect(imageAllowanceLine(null)).toBe('5 free images a day, then ₹1 each');
    expect(imageAllowanceLine(3)).toBe('3 free images left today, then ₹1 each');
    expect(imageAllowanceLine(1)).toBe('1 free image left today, then ₹1 each');
    expect(imageAllowanceLine(0)).toBe('Free images used for today · ₹1 per image');
    // One generator since 2026-10-05: the header IS the price line, and it never claims "no daily limit".
    const screen = read('src/components/ide/AIImageGenerator.tsx');
    expect(screen).toMatch(/<p className="text-xs text-faint truncate">\{imageAllowanceLine\(freeLeft\)\}<\/p>/);
    expect(screen).not.toMatch(/no daily limit/i);
  });
});
