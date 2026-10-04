// AN APP'S PICTURES NEED A KEY — AND THE OWNER IS TOLD WHICH, WHERE, AND WHERE TO PASTE IT (admin 2026-10-04,
// build report cc3ef776).
//
// Admin, verbatim: "1. user ko saaf saaf bolo ki API keys chahiye. 2. user ko navbhatai api keys ka offer den,
// aur bhi api keys ke bare me bataye jaise grok.gemini,chatgpt user jo bhi select kare uski location/link
// bataye, user ko guide kare ki keys kaha dalni hai!!"
//
// The free image provider now answers 401 to every request without a key, and a key may never sit in browser
// code. So an app's pictures go through NavBharatAI's gateway with the OWNER's saved key. These tests lock:
//   1. which saved key is used (one table, IMAGE_PROVIDER wins, aliases), and that a refused key is reported
//      in the owner's words — never silently swapped for NavBharatAI's wallet;
//   2. each provider gets its own key in a header, never in an address, and the nudity filter is NAMED;
//   3. the published-app snippet and the preview shim both expose NavAI.image();
//   4. the Developer API's image request is read strictly, and a key without "Images" is refused first;
//   5. the one picture path (imageForApp) tells the owner and a visitor different, honest things.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import vm from 'node:vm';

const vault = vi.hoisted(() => ({ secrets: {} as Record<string, string> }));
const usage = vi.hoisted(() => ({ appCalls: 0, visitorCalls: 0, recorded: [] as unknown[] }));
const apiKey = vi.hoisted(() => ({ resolve: vi.fn(), image: vi.fn() }));

vi.mock('../src/server/lib/secrets', () => ({ loadUserVaultSecrets: vi.fn(async () => vault.secrets) }));
vi.mock('../src/server/lib/AppAiUsageStore', () => ({
  appAiUsageStore: {
    callsToday: vi.fn(async () => ({ appCalls: usage.appCalls, visitorCalls: usage.visitorCalls, known: true })),
    record: vi.fn(async (...a: unknown[]) => { usage.recorded.push(a); }),
  },
}));
vi.mock('../src/server/lib/apiKeyImage', async (orig) => ({
  ...(await orig<typeof import('../src/server/lib/apiKeyImage')>()),
  resolveApiKey: apiKey.resolve,
  imageForApiKey: apiKey.image,
}));

import {
  appImageKeyFromSecrets, drawWithOwnImageKey, ownImageKeyMessage, needsImageKeyMessage,
  APP_IMAGE_KEY_OPTIONS, APP_KEYS_PLACE, VISITOR_IMAGE_UNAVAILABLE,
} from '../src/server/lib/appImageKeys';
import { imageForApp, imageCounterId, readAppImagePrompt, APP_IMAGES_PER_DAY } from '../src/server/lib/appAiImage';
import { readImageGenerationRequest, SCOPE_ROUTES } from '../src/server/lib/developerApi';
import { API_SCOPES } from '../src/server/lib/ApiKeyManager';
import { gatewayScriptHtml, IMAGE_GATEWAY_PATH } from '../src/server/lib/appAiGateway';
import { previewAiShimSource, readPreviewAiImageAsk, PREVIEW_AI_IMAGE_ASK, PREVIEW_AI_IMAGE_ANSWER } from '../src/lib/previewAiProtocol';
import { isSecretEnvFile, identitySource } from '../src/server/AgentV3/snapshotIdentity';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
const SQ = { w: 1024, h: 1024 };

describe('1 · which saved key makes the pictures', () => {
  it('none saved ⇒ null; a too-short value is not a key', () => {
    expect(appImageKeyFromSecrets(null)).toBeNull();
    expect(appImageKeyFromSecrets({})).toBeNull();
    expect(appImageKeyFromSecrets({ OPENAI_API_KEY: 'sk-short' })).toBeNull();
  });

  it('the table order: NavBharatAI first, then OpenAI, Gemini, xAI, Pollinations', () => {
    const all = {
      POLLINATIONS_API_KEY: 'sk_pollinations_0123456789', XAI_API_KEY: 'xai-0123456789abcdef',
      GEMINI_API_KEY: 'AIza0123456789abcdef', OPENAI_API_KEY: 'sk-openai-0123456789', NAVBHARATAI_API_KEY: 'nbai_0123456789abcdef',
    };
    expect(appImageKeyFromSecrets(all)?.provider).toBe('navbharatai');
    const { NAVBHARATAI_API_KEY: _n, ...noNav } = all;
    expect(appImageKeyFromSecrets(noNav)?.provider).toBe('openai');
    expect(APP_IMAGE_KEY_OPTIONS.map((o) => o.provider)).toEqual(['navbharatai', 'openai', 'gemini', 'xai', 'pollinations']);
  });

  it('IMAGE_PROVIDER picks among saved keys (grok / chatgpt understood); aliases count; a model secret is read', () => {
    const s = { OPENAI_API_KEY: 'sk-openai-0123456789', GROK_API_KEY: 'xai-0123456789abcdef', IMAGE_PROVIDER: 'grok', XAI_IMAGE_MODEL: 'grok-2-image-1212' };
    expect(appImageKeyFromSecrets(s)).toEqual({ provider: 'xai', key: 'xai-0123456789abcdef', model: 'grok-2-image-1212' });
    expect(appImageKeyFromSecrets({ ...s, IMAGE_PROVIDER: 'chatgpt' })?.provider).toBe('openai');
    expect(appImageKeyFromSecrets({ GOOGLE_API_KEY: 'AIza0123456789abcdef' })?.provider).toBe('gemini');
    // A named provider with no saved key falls back to the table, never to nothing.
    expect(appImageKeyFromSecrets({ OPENAI_API_KEY: 'sk-openai-0123456789', IMAGE_PROVIDER: 'gemini' })?.provider).toBe('openai');
  });

  it('the owner\'s message names every option, its link, its secret name and where to paste it', () => {
    const m = needsImageKeyMessage();
    expect(m).toContain('needs an API key');
    expect(m).toContain(APP_KEYS_PLACE);
    for (const o of APP_IMAGE_KEY_OPTIONS) {
      expect(m).toContain(o.secret);
      expect(m).toContain(o.getIt);
    }
    expect(ownImageKeyMessage('openai', 'refused')).toContain(APP_KEYS_PLACE);
    // 🔒 a VISITOR never reads the owner's setup or a vendor name.
    expect(VISITOR_IMAGE_UNAVAILABLE).not.toMatch(/key|openai|gemini|grok|xai|pollinations|secret/i);
  });
});

describe('2 · each company gets its own key, in a header', () => {
  const capture = (respond: (url: string) => Response) => {
    const calls: Array<{ url: string; init: RequestInit & { headers: Record<string, string> } }> = [];
    const fetchImpl = vi.fn(async (u: string, init: RequestInit & { headers: Record<string, string> }) => { calls.push({ url: u, init }); return respond(u); });
    return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
  };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

  it('OpenAI: images API, Bearer key, the size follows the shape', async () => {
    const { calls, fetchImpl } = capture(() => json({ data: [{ b64_json: PNG }] }));
    const r = await drawWithOwnImageKey({ provider: 'openai', key: 'sk-own-openai', model: '' }, 'a tiger', { w: 1536, h: 1024 }, { fetchImpl });
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/images/generations');
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer sk-own-openai');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ model: 'gpt-image-1', prompt: 'a tiger', n: 1, size: '1536x1024' });
  });

  it('Gemini: the key in x-goog-api-key, never in the address', async () => {
    const { calls, fetchImpl } = capture(() => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG } }] } }] }));
    const r = await drawWithOwnImageKey({ provider: 'gemini', key: 'AIzaOwnGeminiKey', model: '' }, 'a tiger', SQ, { fetchImpl });
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).not.toContain('AIzaOwnGeminiKey');
    expect(calls[0]!.init.headers['x-goog-api-key']).toBe('AIzaOwnGeminiKey');
  });

  it('xAI: b64 answer, Bearer key', async () => {
    const { calls, fetchImpl } = capture(() => json({ data: [{ b64_json: PNG }] }));
    const r = await drawWithOwnImageKey({ provider: 'xai', key: 'xai-own', model: '' }, 'a tiger', SQ, { fetchImpl });
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toBe('https://api.x.ai/v1/images/generations');
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer xai-own');
  });

  it('🔒 Pollinations: the keyed host, the key in a header, private, and the nudity filter NAMED', async () => {
    const { calls, fetchImpl } = capture(() => new Response(Buffer.from(PNG, 'base64'), { status: 200, headers: { 'content-type': 'image/png' } }));
    const r = await drawWithOwnImageKey({ provider: 'pollinations', key: 'sk_own_poll', model: '' }, 'a tiger', { w: 768, h: 512 }, { fetchImpl, seed: 9 });
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toBe('https://gen.pollinations.ai/image/a%20tiger?width=768&height=512&seed=9&nologo=true&private=true&safe=privacy,secrets,sexual,violence');
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer sk_own_poll');
  });

  it('a refused key is "refused", a busy one "busy" — the owner\'s own words, never a swap to our engine', async () => {
    expect(await drawWithOwnImageKey({ provider: 'openai', key: 'k', model: '' }, 'a tiger', SQ, { fetchImpl: capture(() => json({}, 401)).fetchImpl }))
      .toEqual({ ok: false, reason: 'refused' });
    expect(await drawWithOwnImageKey({ provider: 'xai', key: 'k', model: '' }, 'a tiger', SQ, { fetchImpl: capture(() => json({}, 429)).fetchImpl }))
      .toEqual({ ok: false, reason: 'busy' });
    expect(await drawWithOwnImageKey({ provider: 'navbharatai', key: 'k', model: '' }, 'a tiger', SQ)).toEqual({ ok: false, reason: 'failed' });
  });

  it('🔒 a banned description reaches no company at all', async () => {
    const { calls, fetchImpl } = capture(() => json({ data: [{ b64_json: PNG }] }));
    const r = await drawWithOwnImageKey({ provider: 'openai', key: 'k', model: '' }, 'nude woman', SQ, { fetchImpl });
    expect(r).toEqual({ ok: false, reason: 'blocked' });
    expect(calls).toHaveLength(0);
  });
});

describe('3 · the page gets NavAI.image() — published and in the preview', () => {
  it('the published snippet posts {token, prompt, width, height} to the image route and resolves the data URL', async () => {
    const html = gatewayScriptHtml('app1', 'tok-1', 'https://navbharatai.com/');
    const src = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    const posts: Array<{ url: string; body: unknown }> = [];
    const win: Record<string, unknown> = {};
    const ctx = vm.createContext({
      window: win,
      JSON,
      fetch: async (url: string, init: { body: string }) => {
        posts.push({ url, body: JSON.parse(init.body) });
        return { json: async () => ({ ok: true, image: `data:image/png;base64,${PNG}` }) };
      },
    });
    vm.runInContext(src, ctx);
    const navAI = win.NavAI as { image(p: string, o: { width: number; height: number }): Promise<string> };
    await expect(navAI.image('a tiger', { width: 512, height: 768 })).resolves.toBe(`data:image/png;base64,${PNG}`);
    expect(posts).toEqual([{ url: `https://navbharatai.com${IMAGE_GATEWAY_PATH}`, body: { token: 'tok-1', prompt: 'a tiger', width: 512, height: 768 } }]);
  });

  it('a refusal from the route becomes an Error with the route\'s message', async () => {
    const src = gatewayScriptHtml('app1', 'tok-1', 'https://x').replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    const win: Record<string, unknown> = {};
    vm.runInContext(src, vm.createContext({ window: win, JSON, fetch: async () => ({ json: async () => ({ ok: false, message: VISITOR_IMAGE_UNAVAILABLE }) }) }));
    await expect((win.NavAI as { image(p: string): Promise<string> }).image('a tiger')).rejects.toThrow(VISITOR_IMAGE_UNAVAILABLE);
  });

  it('the preview shim relays a picture ask to the parent and carries the answer\'s code back', async () => {
    const listeners: Array<(e: unknown) => void> = [];
    const sent: unknown[] = [];
    const parent = { postMessage: (m: unknown) => sent.push(m) };
    const win: Record<string, unknown> = {
      parent,
      top: parent,
      addEventListener: (_t: string, fn: (e: unknown) => void) => listeners.push(fn),
    };
    vm.runInContext(previewAiShimSource(), vm.createContext({ window: win, Date, Promise, setTimeout, String, Error }));
    const p = (win.NavAI as { image(p: string, o: { width: number; height: number }): Promise<string> }).image('a tiger', { width: 640, height: 480 });
    const ask = readPreviewAiImageAsk(sent[0]);
    expect(ask).toMatchObject({ prompt: 'a tiger', width: 640, height: 480 });
    for (const fn of listeners) fn({ source: parent, data: { [PREVIEW_AI_IMAGE_ANSWER]: true, id: ask!.id, ok: false, message: 'Add a key', code: 'needs-key' } });
    await expect(p).rejects.toMatchObject({ message: 'Add a key', code: 'needs-key' });
    expect(readPreviewAiImageAsk({ [PREVIEW_AI_IMAGE_ASK]: true, id: '' })).toBeNull();
  });
});

describe('4 · the Developer API image request', () => {
  it('"Images" is a scope with its own route', () => {
    expect(API_SCOPES).toContain('ai:images');
    expect(SCOPE_ROUTES['ai:images']).toEqual({ method: 'POST', path: '/api/v1/images/generations' });
  });

  it('reads size "WxH" or width/height, clamps, and refuses what it cannot honour', () => {
    expect(readImageGenerationRequest({ prompt: ' a tiger ', size: '1536x1024' })).toEqual({ ok: true, prompt: 'a tiger', px: { w: 1536, h: 1024 } });
    expect(readImageGenerationRequest({ prompt: 'a', width: 5000, height: 10 })).toEqual({ ok: true, prompt: 'a', px: { w: 1536, h: 256 } });
    expect(readImageGenerationRequest({ prompt: 'a' })).toMatchObject({ ok: true, px: { w: 1024, h: 1024 } });
    expect(readImageGenerationRequest({})).toMatchObject({ ok: false });
    expect(readImageGenerationRequest({ prompt: 'x'.repeat(2001) })).toMatchObject({ ok: false });
    expect(readImageGenerationRequest({ prompt: 'a', n: 2 })).toMatchObject({ ok: false });
    expect(readImageGenerationRequest({ prompt: 'a', response_format: 'url' })).toMatchObject({ ok: false });
    expect(readImageGenerationRequest({ prompt: 'a', size: 'big' })).toMatchObject({ ok: false });
  });

  it('🔒 a key without "Images" is refused before anything is read or spent', async () => {
    const { imageForApiKey: real } = await vi.importActual<typeof import('../src/server/lib/apiKeyImage')>('../src/server/lib/apiKeyImage');
    const r = await real({ userId: 'u1', keyId: 'k1', scopes: ['ai:chat'] }, 'a tiger', SQ, 'api');
    expect(r).toMatchObject({ ok: false, status: 403, code: 'missing_scope' });
  });
});

describe('5 · the one picture path for an app', () => {
  const ask = (prompt = 'a tiger') => ({
    ownerId: 'owner1', workspaceId: 'ws1', prompt, px: SQ,
    counter: { appId: imageCounterId('app1'), visitor: 'v1', day: '2026-10-04', appLimit: APP_IMAGES_PER_DAY, visitorLimit: 10 },
  });
  beforeEach(() => {
    vault.secrets = {};
    usage.appCalls = 0; usage.visitorCalls = 0; usage.recorded = [];
    apiKey.resolve.mockReset(); apiKey.image.mockReset();
  });

  it('🔒 cc3ef776: no key ⇒ the OWNER reads every option and where to paste it; a VISITOR reads only "not set up yet"', async () => {
    const r = await imageForApp(ask());
    expect(r).toMatchObject({ ok: false, code: 'needs-key', owner: needsImageKeyMessage(), visitor: VISITOR_IMAGE_UNAVAILABLE });
  });

  it('a NavBharatAI key goes through the Developer API\'s own checks and charge', async () => {
    vault.secrets = { NAVBHARATAI_API_KEY: 'nbai_0123456789abcdef' };
    apiKey.resolve.mockResolvedValue({ userId: 'owner1', keyId: 'k1', scopes: ['ai:images'] });
    apiKey.image.mockResolvedValue({ ok: true, image: { mimeType: 'image/png', base64: PNG }, chargedInr: 1, freeLeftToday: 0 });
    const r = await imageForApp(ask());
    expect(r).toMatchObject({ ok: true, via: 'navbharatai' });
    expect(apiKey.image).toHaveBeenCalledWith({ userId: 'owner1', keyId: 'k1', scopes: ['ai:images'] }, 'a tiger', SQ, 'app');
  });

  it('a revoked NavBharatAI key tells the owner where to make a new one', async () => {
    vault.secrets = { NAVBHARATAI_API_KEY: 'nbai_revoked_0123456789' };
    apiKey.resolve.mockResolvedValue(null);
    const r = await imageForApp(ask());
    expect(r).toMatchObject({ ok: false, code: 'key-problem', visitor: VISITOR_IMAGE_UNAVAILABLE });
    expect(r.ok === false && r.owner).toContain('Developer Tools');
    expect(apiKey.image).not.toHaveBeenCalled();
  });

  it('the daily picture limits hold, before any key is read', async () => {
    vault.secrets = { NAVBHARATAI_API_KEY: 'nbai_0123456789abcdef' };
    usage.appCalls = APP_IMAGES_PER_DAY;
    expect(await imageForApp(ask())).toMatchObject({ ok: false, code: 'limit' });
    usage.appCalls = 0; usage.visitorCalls = 10;
    expect(await imageForApp(ask())).toMatchObject({ ok: false, code: 'limit' });
    expect(apiKey.resolve).not.toHaveBeenCalled();
  });

  it('🔒 a banned description is refused before the vault is even opened', async () => {
    vault.secrets = { NAVBHARATAI_API_KEY: 'nbai_0123456789abcdef' };
    expect(await imageForApp(ask('nude woman'))).toMatchObject({ ok: false, code: 'blocked' });
    expect(apiKey.resolve).not.toHaveBeenCalled();
  });

  it('the request body is read strictly', () => {
    expect(readAppImagePrompt({ prompt: '  a tiger ' })).toEqual({ ok: true, prompt: 'a tiger' });
    expect(readAppImagePrompt({})).toMatchObject({ ok: false });
    expect(readAppImagePrompt({ prompt: 'x'.repeat(2001) })).toMatchObject({ ok: false });
    expect(imageCounterId('app1')).toBe('img_app1');
  });
});

describe('6 · a saved key is never part of the preview copy\'s identity (cc3ef776 PREVIEW_SNAPSHOT_STALE)', () => {
  it.each(['.env', '.env.local', 'app/.env.production', '.ENV'])('%s is a secrets file', (p) => expect(isSecretEnvFile(p)).toBe(true));
  it.each(['.env.example', '.env.sample', '.env.template', 'src/env.ts', 'environment.md'])('%s is not', (p) => expect(isSecretEnvFile(p)).toBe(false));
  it('identitySource drops it and keeps everything else', () => {
    const out = identitySource({ '.env': 'KEY=1', '.env.example': 'KEY=', 'src/App.tsx': 'x' });
    expect(Object.keys(out).sort()).toEqual(['.env.example', 'src/App.tsx']);
  });
});
