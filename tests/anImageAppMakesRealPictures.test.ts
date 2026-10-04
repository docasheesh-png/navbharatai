// AN IMAGE APP MAKES REAL PICTURES (admin 2026-10-01): "jab user apni api key dalna chahe kisi aur provider
// ki to bhi dal sakta ho, jab chahe change kare, agar user keys na de, to default pollination ai".
//
// 🔴 2026-10-04 (build cc3ef776): the keyless default no longer exists at the provider (it answers 401 to
// every request without a key), so the admin ruled: "user ko saaf saaf bolo ki API keys chahiye … navbhatai
// api keys ka offer den … grok, gemini, chatgpt … guide kare ki keys kaha dalni hai". The browser engine now
// asks NavBharatAI (window.NavAI.image) and the server engine refuses honestly ("needs-key") with no key.
//
// The `generate_image_ai` recipe writes a modular image engine into the user's app. These tests:
//   1. compile every file it writes with the REAL TypeScript compiler, under the strictest settings a Vite
//      project uses (a recipe that does not compile in the user's app is worse than none);
//   2. RUN the generated browser and server code against a fake network — retries, timeouts, rate limits,
//      a refused key, a non-image answer, a blocked read, and that a key never goes to the wrong company;
//   3. check the builder is told to use it, the fast lane steps aside, and the recipe is reachable.
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import { generateImageAiIntegration, IMAGE_ENDPOINT } from '../src/server/lib/ImageAiGenerator';
import { appGeneratesImages, fastLaneSkipsImageApp, IMAGE_IN_APP_RULE } from '../src/server/AgentV3/inAppImageGeneration';
import { RECIPE_TOOLS, recipeToolDef } from '../src/server/AgentV3/ToolCatalog';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const TMP = join(ROOT, 'tests', `.tmp-image-ai-${process.pid}`);
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function compile(files: Record<string, string>, dir: string): string[] {
  const base = join(TMP, dir);
  const names: string[] = [];
  for (const [p, content] of Object.entries(files)) {
    if (!/[.]tsx?$/.test(p)) continue;
    const full = join(base, p);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
    names.push(full);
  }
  const program = ts.createProgram(names, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    jsx: ts.JsxEmit.ReactJSX,
    types: ['node'],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    isolatedModules: true,
    verbatimModuleSyntax: true,
    erasableSyntaxOnly: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noFallthroughCasesInSwitch: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noPropertyAccessFromIndexSignature: true,
    noImplicitOverride: true,
    noImplicitReturns: true,
  } as ts.CompilerOptions);
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

/** Transpile one generated module and import it, so the real generated code runs. */
async function load<T>(source: string, name: string): Promise<T> {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  mkdirSync(TMP, { recursive: true });
  const file = join(TMP, `${name}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, js);
  return import(file) as Promise<T>;
}

describe('1 · what the recipe writes', () => {
  it('browser mode: one client module (+ the React hook), no server, no env keys, no endpoint', () => {
    const c = generateImageAiIntegration({ server: false, react: true });
    expect(Object.keys(c.files).sort()).toEqual(['src/lib/imageAi.ts', 'src/lib/useImageGenerator.ts']);
    expect(c.envKeys).toEqual([]);
    expect(c.files['src/lib/imageAi.ts']).toContain('const SERVER_ENDPOINT: string | null = null;');
    expect(c.files['src/lib/imageAi.ts']).toContain('class NavAIImageProvider');
    // 🔒 cc3ef776: no anonymous call to a provider that answers 401 to every keyless request.
    expect(c.files['src/lib/imageAi.ts']).not.toMatch(/pollinations\.ai/);
  });

  it('🔒 cc3ef776: the builder is told keys are REQUIRED, every option with its link, and where to paste it', () => {
    for (const server of [false, true]) {
      const text = generateImageAiIntegration({ server, react: true }).instructions;
      expect(text).toContain('need an image API key');
      for (const s of ['NAVBHARATAI_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'POLLINATIONS_API_KEY',
        'https://platform.openai.com/api-keys', 'https://aistudio.google.com/apikey', 'https://console.x.ai', 'https://enter.pollinations.ai',
        'Keys & Secrets']) {
        expect(text, s).toContain(s);
      }
      expect(text).toContain('Never say the pictures are free or that no key is needed.');
      expect(text.replace('Never say the pictures are free or that no key is needed.', '')).not.toMatch(/no (api )?key (is )?needed|keyless/i);
    }
  });

  it('🔒 the download link that opens a new tab carries rel=noopener (no reverse tabnabbing)', () => {
    const src = generateImageAiIntegration({ server: false, react: false }).files['src/lib/imageAi.ts']!;
    expect(src).toMatch(/link\.rel = 'noopener noreferrer';\s+link\.target = '_blank';/);
  });

  it('server mode: the client posts to the route, the server module and .env.example are written', () => {
    const c = generateImageAiIntegration({ server: true, react: false });
    expect(Object.keys(c.files).sort()).toEqual(['.env.example', 'server/lib/imageAi.ts', 'src/lib/imageAi.ts']);
    expect(c.files['src/lib/imageAi.ts']).toContain(`const SERVER_ENDPOINT: string | null = '${IMAGE_ENDPOINT}';`);
    expect(c.files['.env.example']).toMatch(/^IMAGE_PROVIDER=\nIMAGE_API_KEY=\n/);
    expect(c.instructions).toContain('Settings → App Settings → Secrets & API Keys');
  });

  it('🔒 no key, no env name and no secret-reading code is ever in browser code', () => {
    for (const server of [false, true]) {
      const c = generateImageAiIntegration({ server, react: true });
      for (const p of ['src/lib/imageAi.ts', 'src/lib/useImageGenerator.ts']) {
        expect(c.files[p], p).not.toMatch(/IMAGE_API_KEY|process\.env|import\.meta\.env|Authorization/);
      }
    }
  });

  it('nothing in the generated sources was evaluated by our own template literals', () => {
    for (const server of [false, true]) {
      for (const content of Object.values(generateImageAiIntegration({ server, react: true }).files)) {
        expect(content).not.toContain('${');
        expect(content).not.toContain('undefined;\n'.repeat(2));
      }
    }
  });
});

describe('2 · it compiles in the user\'s app (real TypeScript, strict Vite settings)', () => {
  it('browser mode + React hook', () => {
    expect(compile(generateImageAiIntegration({ server: false, react: true }).files, 'browser')).toEqual([]);
  });
  it('server mode + React hook, including the server module', () => {
    expect(compile(generateImageAiIntegration({ server: true, react: true }).files, 'server')).toEqual([]);
  });
}, 60_000);

interface Img { url: string; blob: Blob | null; provider: string }
interface Client {
  generateImage(req: { prompt: string; width?: number; height?: number; seed?: number }, opts?: Record<string, unknown>): Promise<Img>;
  releaseImage(img: Img): void;
}

describe('3 · the browser engine asks NavBharatAI (window.NavAI.image), run against a fake NavAI', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const client = () => load<Client>(generateImageAiIntegration({ server: false, react: false }).files['src/lib/imageAi.ts']!, 'client');
  const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
  const navAI = (image: (p: string, o: { width: number; height: number }) => Promise<string>) => {
    const fn = vi.fn(image);
    vi.stubGlobal('NavAI', { image: fn });
    return fn;
  };

  it('a prompt goes to NavAI.image with its size, and the data URL becomes a picture with bytes', async () => {
    const f = navAI(async () => PNG);
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const m = await client();
    const img = await m.generateImage({ prompt: '  a red fort at sunset ', width: 768, height: 512, seed: 7 });
    expect(f).toHaveBeenCalledWith('a red fort at sunset', { width: 768, height: 512 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(img.provider).toBe('NavBharatAI');
    expect(img.blob?.size).toBe(4);
    expect(img.blob?.type).toBe('image/png');
    expect(img.url.startsWith('blob:')).toBe(true);
    m.releaseImage(img);
  });

  it('🔒 cc3ef776: outside NavBharatAI (no window.NavAI) the error is "needs-key" in words, and nothing is called', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('NavAI', undefined);
    const m = await client();
    await expect(m.generateImage({ prompt: 'tiger' })).rejects.toMatchObject({ code: 'needs-key', retryable: false, message: expect.stringContaining('Keys & Secrets') });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the gateway\'s "needs-key" refusal reaches the page with the owner\'s guidance, not retried', async () => {
    const f = navAI(async () => { throw Object.assign(new Error('This app needs an image API key. Add one in Keys & Secrets.'), { code: 'needs-key' }); });
    const m = await client();
    await expect(m.generateImage({ prompt: 'tiger' })).rejects.toMatchObject({ code: 'needs-key', message: 'This app needs an image API key. Add one in Keys & Secrets.' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('an empty or over-long prompt is refused before NavAI is asked', async () => {
    const f = navAI(async () => PNG);
    const m = await client();
    await expect(m.generateImage({ prompt: '   ' })).rejects.toMatchObject({ code: 'invalid-prompt' });
    await expect(m.generateImage({ prompt: 'x'.repeat(1001) })).rejects.toMatchObject({ code: 'invalid-prompt' });
    expect(f).not.toHaveBeenCalled();
  });

  it('an answer that is not an image data URL is not a picture', async () => {
    navAI(async () => 'https://example.com/cat.png');
    const m = await client();
    await expect(m.generateImage({ prompt: 'tiger' })).rejects.toMatchObject({ code: 'failed' });
  });

  it('a slow answer times out, and the message is about time', async () => {
    navAI(() => new Promise<string>(() => undefined));
    const m = await client();
    vi.useFakeTimers();
    const p = m.generateImage({ prompt: 'tiger' }, { timeoutMs: 1000, retries: 0 });
    const check = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1001);
    await check;
  });

  it('a stop from the user is a cancel, never retried', async () => {
    const f = navAI(() => new Promise<string>(() => undefined));
    const m = await client();
    const ctl = new AbortController();
    const p = m.generateImage({ prompt: 'tiger' }, { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('server mode posts the job to the app\'s own route and reads which engine answered', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: { body: string }) => {
      calls.push({ url: u, body: init.body });
      return new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'content-type': 'image/jpeg', 'x-image-provider': 'Stability AI' } });
    }));
    const m = await load<Client>(generateImageAiIntegration({ server: true, react: false }).files['src/lib/imageAi.ts']!, 'client-server');
    const img = await m.generateImage({ prompt: 'tiger', seed: 3 });
    expect(calls[0]!.url).toBe('/api/generate-image');
    expect(JSON.parse(calls[0]!.body)).toEqual({ prompt: 'tiger', width: 1024, height: 1024, seed: 3 });
    expect(img.provider).toBe('Stability AI');
  });
});

interface Out { status: number; headers: Record<string, string>; body: unknown }
interface Res { status(c: number): unknown; setHeader(n: string, v: string): unknown; send(b: unknown): unknown; json(b: unknown): unknown }
interface Server {
  handleImageRequest(input: unknown, client: string, env?: Record<string, string>): Promise<Out>;
  imageRoute(): (req: { body?: unknown; ip?: string }, res: Res) => Promise<void>;
}

describe('4 · the server engine: no key ⇒ an honest needs-key, a key ⇒ that provider, a key never leaks', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const server = () => load<Server>(generateImageAiIntegration({ server: true, react: false }).files['server/lib/imageAi.ts']!, 'server');
  const png = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } });

  it('🔒 cc3ef776: no key at all ⇒ 503 "needs-key" naming where to add one, and NOTHING is sent anywhere', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const m = await server();
    const out = await m.handleImageRequest({ prompt: 'tiger', seed: 5 }, 'a', { IMAGE_PROVIDER: 'openai', IMAGE_MODEL: 'gpt-image-1' });
    expect(out.status).toBe(503);
    expect(out.body).toMatchObject({ code: 'needs-key', error: expect.stringContaining('Keys & Secrets') });
    expect(f).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it.each([
    ['NAVBHARATAI_API_KEY', 'nbai_owner_key_123', 'https://navbharatai.com/api/v1/images/generations'],
    ['OPENAI_API_KEY', 'sk-owner-openai', 'https://api.openai.com/v1/images/generations'],
    ['GEMINI_API_KEY', 'AIzaOwnerGemini', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent'],
    ['XAI_API_KEY', 'xai-owner', 'https://api.x.ai/v1/images/generations'],
    ['GROK_API_KEY', 'xai-owner-grok', 'https://api.x.ai/v1/images/generations'],
  ])('a key saved by its own name (%s) goes to that company only, in a header', async (name, key, url) => {
    const calls: Array<{ url: string; init: { headers: Record<string, string> } }> = [];
    const b64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: { headers: Record<string, string> }) => {
      calls.push({ url: u, init });
      const body = u.includes('generativelanguage')
        ? { candidates: [{ content: { parts: [{ inlineData: { data: b64 } }] } }] }
        : { data: [{ b64_json: b64 }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const m = await server();
    const out = await m.handleImageRequest({ prompt: 'tiger' }, `k-${name}`, { [name]: key });
    expect(out.status).toBe(200);
    expect(out.headers['Content-Type']).toBe('image/png');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(url);
    expect(calls[0]!.url).not.toContain(key);
    expect(Object.values(calls[0]!.init.headers).join(' ')).toContain(key);
  });

  it('IMAGE_API_KEY with no IMAGE_PROVIDER: the provider is read from an unmistakable key shape', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(u);
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } });
    }));
    const m = await server();
    await m.handleImageRequest({ prompt: 'tiger' }, 'shape', { IMAGE_API_KEY: 'sk_pollinations_secret' });
    expect(calls[0]!.startsWith('https://gen.pollinations.ai/image/tiger?')).toBe(true);
  });

  it('IMAGE_PROVIDER=pollinations with a key: the keyed host, the key in a header, never in the address', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: { headers: Record<string, string> }) => { calls.push({ url: u, headers: init.headers }); return png(); }));
    const m = await server();
    await m.handleImageRequest({ prompt: 'tiger' }, 'b', { IMAGE_PROVIDER: 'pollinations', IMAGE_API_KEY: 'sk_secret' });
    expect(calls[0]!.url.startsWith('https://gen.pollinations.ai/image/tiger?')).toBe(true);
    expect(calls[0]!.url).not.toContain('sk_secret');
    // 🔒 on the current API safe=true alone is only privacy — the nudity filter must be named.
    expect(calls[0]!.url).toContain('&private=true&safe=privacy,secrets,sexual,violence');
    expect(calls[0]!.headers).toEqual({ Authorization: 'Bearer sk_secret' });
  });

  it('IMAGE_PROVIDER=openai: the images API on the owner\'s key, any compatible host, base64 decoded', async () => {
    const calls: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url: u, init });
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from([0xff, 0xd8, 0xff]).toString('base64') }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const m = await server();
    const out = await m.handleImageRequest({ prompt: 'tiger', width: 1536, height: 1024 }, 'c', { IMAGE_PROVIDER: 'openai', IMAGE_API_KEY: 'sk-own', IMAGE_BASE_URL: 'https://api.example.ai/v1/' });
    expect(calls[0]!.url).toBe('https://api.example.ai/v1/images/generations');
    expect(calls[0]!.init.headers['Authorization']).toBe('Bearer sk-own');
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ model: 'gpt-image-1', prompt: 'tiger', n: 1, size: '1536x1024' });
    expect(out.status).toBe(200);
    expect(out.headers['Content-Type']).toBe('image/jpeg');
  });

  it('IMAGE_PROVIDER=stability: multipart form to Stability with Accept image/*', async () => {
    const calls: Array<{ url: string; init: { headers: Record<string, string>; body: FormData } }> = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: { headers: Record<string, string>; body: FormData }) => { calls.push({ url: u, init }); return png(); }));
    const m = await server();
    const out = await m.handleImageRequest({ prompt: 'tiger', width: 1024, height: 576 }, 'd', { IMAGE_PROVIDER: 'stability', IMAGE_API_KEY: 'sk-stab' });
    expect(calls[0]!.url).toBe('https://api.stability.ai/v2beta/stable-image/generate/core');
    expect(calls[0]!.init.headers).toEqual({ Authorization: 'Bearer sk-stab', Accept: 'image/*' });
    expect(calls[0]!.init.body.get('aspect_ratio')).toBe('16:9');
    expect(out.headers['X-Image-Provider']).toBe('Stability AI');
  });

  it('🔒 a key with an unknown provider is NEVER sent anywhere — an honest 500 instead', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const m = await server();
    const out = await m.handleImageRequest({ prompt: 'tiger' }, 'e', { IMAGE_API_KEY: 'whose-key-is-this-0123' });
    expect(out.status).toBe(500);
    expect(out.body).toEqual({ error: 'Image generation is not set up correctly on this server.', code: 'not-configured' });
    expect(f).not.toHaveBeenCalled();
    expect(JSON.stringify(err.mock.calls)).not.toContain('whose-key-is-this-0123');
    err.mockRestore();
  });

  it('a refused key is a 502 a visitor can read, with no key or provider detail in it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"bad key sk-own"}', { status: 401 })));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const m = await server();
    const out = await m.handleImageRequest({ prompt: 'tiger' }, 'f', { IMAGE_PROVIDER: 'openai', IMAGE_API_KEY: 'sk-own' });
    expect(out.status).toBe(502);
    expect(JSON.stringify(out.body)).not.toMatch(/sk-own|openai|IMAGE_/i);
    err.mockRestore();
  });

  it('upstream rate limit passes Retry-After through; our own per-visitor limit applies; bad input is a 400', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429, headers: { 'retry-after': '12' } })));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const m = await server();
    const up = await m.handleImageRequest({ prompt: 'tiger' }, 'g', { POLLINATIONS_API_KEY: 'sk_rate' });
    expect(up.status).toBe(429);
    expect(up.headers['Retry-After']).toBe('12');
    vi.stubGlobal('fetch', vi.fn(async () => png()));
    const env = { IMAGE_RATE_PER_MINUTE: '2', POLLINATIONS_API_KEY: 'sk_rate' };
    expect((await m.handleImageRequest({ prompt: 'a' }, 'h', env)).status).toBe(200);
    expect((await m.handleImageRequest({ prompt: 'a' }, 'h', env)).status).toBe(200);
    expect((await m.handleImageRequest({ prompt: 'a' }, 'h', env)).status).toBe(429);
    expect((await m.handleImageRequest({ prompt: '' }, 'i', {})).status).toBe(400);
    expect((await m.handleImageRequest(null, 'i', {})).status).toBe(400);
    err.mockRestore();
  });

  it('the Express-style route sends bytes for a picture and JSON for an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => png()));
    vi.stubEnv('POLLINATIONS_API_KEY', 'sk_route_test');
    const m = await server();
    const seen = { code: 0, sent: null as unknown, json: null as unknown };
    const res: Res = {
      status(c) { seen.code = c; return res; },
      setHeader() { return res; },
      send(b) { seen.sent = b; return res; },
      json(b) { seen.json = b; return res; },
    };
    await m.imageRoute()({ body: { prompt: 'tiger' }, ip: 'j' }, res);
    expect(seen.code).toBe(200);
    expect(Buffer.isBuffer(seen.sent)).toBe(true);
    await m.imageRoute()({ body: {}, ip: 'j' }, res);
    expect(seen.code).toBe(400);
    expect(seen.json).toMatchObject({ code: 'invalid-prompt' });
  });
});

describe('5 · the request is understood', () => {
  const YES = [
    'Build me an AI Image Generator app',
    'Create an Image Maker',
    'Make an app that generates images from text prompts',
    'Create an AI image generator where users can enter a prompt and generate images.',
    'text-to-image app with a gallery',
    'AI logo creator for small shops',
    'wallpaper generator app',
    'ek image banane wala app banao',
    'prompt se tasveer banane wali app',
    'इमेज बनाने वाला ऐप बनाओ',
  ];
  const NO = [
    'Build a todo app',
    'photo gallery with upload',
    'image compressor and resizer',
    'placeholder image generator for designers',
    'QR code generator',
    'meme generator',
    'an e-commerce store with product images',
    'resume maker',
  ];
  it.each(YES)('makes pictures: %s', (p) => expect(appGeneratesImages(p)).toBe(true));
  it.each(NO)('does not: %s', (p) => expect(appGeneratesImages(p)).toBe(false));

  it('the fast lane steps aside for it; AGENTV3_FASTLANE_IMAGE_APPS=on lets it back', () => {
    expect(fastLaneSkipsImageApp(YES[0]!, {} as NodeJS.ProcessEnv)).toBe(true);
    expect(fastLaneSkipsImageApp(YES[0]!, { AGENTV3_FASTLANE_IMAGE_APPS: 'on' } as NodeJS.ProcessEnv)).toBe(false);
    expect(fastLaneSkipsImageApp(NO[0]!, {} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('6 · the builder reaches it', () => {
  it('the recipe is in the run_recipe catalog', () => {
    expect(RECIPE_TOOLS).toContain('generate_image_ai');
    expect(recipeToolDef().description).toContain('- generate_image_ai:');
  });

  it('the architect and every writing sub-agent read the rule', () => {
    expect(architectSystemPrompt()).toContain(IMAGE_IN_APP_RULE);
    expect(read('src/server/AgentV3/SubAgent.ts')).toMatch(/if \(roleExpectsArtifacts\(cfg\.tools\)\) contextBlocks\.push\(IMAGE_IN_APP_RULE\);/);
  });

  it('🔒 the route skips the fast lane for it, and the lane is gated on that', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('fastLaneImageSkip = fastLaneSkipsImageApp(prompt)');
    expect(route).toContain('if (fastLaneWouldRun && !fastLaneRung.skip && !fastLaneGameSkip && !fastLaneImageSkip) {');
  });

  class FakeActuator implements ActuatorPort {
    files = new Map<string, string>([['package.json', '{"name":"app","dependencies":{"react":"^19.0.0"}}']]);
    async readFile(_ws: string, path: string): Promise<string> {
      const f = this.files.get(path);
      if (f === undefined) throw new Error(`ENOENT: ${path}`);
      return f;
    }
    async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
    async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
    async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
  }
  const run = async (act: FakeActuator, input: Record<string, unknown>) => {
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(act, 'ws-image', new WorkspaceState(stream), stream);
    return d.dispatch({ id: 'r1', name: 'run_recipe', input: { name: 'generate_image_ai', input } }, 'architect');
  };

  it('run_recipe writes the browser engine and the React hook for a React app', async () => {
    const act = new FakeActuator();
    const res = await run(act, {});
    expect(res.is_error).toBe(false);
    expect(act.files.has('src/lib/imageAi.ts')).toBe(true);
    expect(act.files.has('src/lib/useImageGenerator.ts')).toBe(true);
    expect(act.files.has('server/lib/imageAi.ts')).toBe(false);
  });

  it('server: true writes the server engine and keeps an existing .env.example', async () => {
    const act = new FakeActuator();
    act.files.set('.env.example', 'DATABASE_URL=\n');
    act.files.set('package.json', '{"name":"plain"}');
    const res = await run(act, { server: true });
    expect(res.is_error).toBe(false);
    expect(act.files.get('.env.example')).toBe('DATABASE_URL=\n');
    expect(String(res.content)).toContain('Kept existing .env.example (add: IMAGE_PROVIDER, IMAGE_API_KEY');
    expect(act.files.has('server/lib/imageAi.ts')).toBe(true);
    expect(act.files.has('src/lib/useImageGenerator.ts')).toBe(false);
  });
});

describe('7 · the AI image generator is the FIRST template (admin 2026-10-01: "sabse pahle … gst, todo uske baad")', () => {
  it('both tiers open on AI image, then GST bill, then to-do', async () => {
    const { partitionStarters, pickerSections } = await import('../src/components/agentv3/starterTemplates');
    for (const unlocked of [false, true]) {
      const first = pickerSections(partitionStarters(unlocked).tappable).initial.map((t) => t.id).slice(0, 3);
      expect(first, unlocked ? 'paid' : 'free').toEqual(['ai-image', 'gst-bill', 'todo']);
    }
  });

  it('the chip is a free-tier template, so every user can tap it', async () => {
    const { STARTER_TEMPLATES } = await import('../src/components/agentv3/starterTemplates');
    const chip = STARTER_TEMPLATES.find((t) => t.id === 'ai-image');
    expect(chip?.tier).toBe('simple');
    expect(appGeneratesImages(chip!.prompt)).toBe(true);
  });

  it('🔒 its golden scaffold runs the recipe\'s own engine, byte for byte — the two cannot drift', async () => {
    const { GOLDEN_SCAFFOLDS, goldenScaffoldFiles, goldenScaffoldForPrompt } = await import('../src/server/AgentV3/goldenScaffolds/registry');
    const { STARTER_TEMPLATES } = await import('../src/components/agentv3/starterTemplates');
    const g = GOLDEN_SCAFFOLDS.find((s) => s.id === 'ai-image')!;
    const files = goldenScaffoldFiles(g);
    const recipe = generateImageAiIntegration({ server: false, react: true }).files;
    expect(files['src/lib/imageAi.ts']).toBe(recipe['src/lib/imageAi.ts']);
    expect(files['src/lib/useImageGenerator.ts']).toBe(recipe['src/lib/useImageGenerator.ts']);
    expect(goldenScaffoldForPrompt(STARTER_TEMPLATES.find((t) => t.id === 'ai-image')!.prompt)?.id).toBe('ai-image');
    expect(files['src/App.tsx']).not.toMatch(/pollinations/i);
  });

  it('the template compiles in the user\'s app under strict settings (real TypeScript)', () => {
    const files: Record<string, string> = {
      ...generateImageAiIntegration({ server: false, react: true }).files,
    };
    // App.tsx imports ./theme; a typed stub stands in for the platform's own theme toggle here.
    files['src/theme.tsx'] = 'export default function ThemeToggle() { return null; }\n';
    files['src/App.tsx'] = read('src/server/AgentV3/goldenScaffolds/aiImage.ts').split('export const aiImageAppTsx = `')[1]!.split('`;\n')[0]!;
    expect(compile(files, 'template')).toEqual([]);
  }, 60_000);
});
