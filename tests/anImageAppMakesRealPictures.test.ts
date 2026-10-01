// AN IMAGE APP MAKES REAL PICTURES (admin 2026-10-01): "jab user apni api key dalna chahe kisi aur provider
// ki to bhi dal sakta ho, jab chahe change kare, agar user keys na de, to default pollination ai".
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
    if (!p.endsWith('.ts')) continue;
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
    expect(c.files['src/lib/imageAi.ts']).toContain('https://image.pollinations.ai/prompt/');
    expect(c.files['src/lib/imageAi.ts']).toContain('&safe=true');
    expect(c.files['src/lib/imageAi.ts']).toContain('private=true');
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

describe('3 · the browser engine, run against a fake network', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const client = () => load<Client>(generateImageAiIntegration({ server: false, react: false }).files['src/lib/imageAi.ts']!, 'client');
  const png = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } });

  it('a prompt becomes a real Pollinations request and a picture', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(u); return png(); }));
    const m = await client();
    const img = await m.generateImage({ prompt: '  a red fort at sunset ', width: 768, height: 512, seed: 7 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('https://image.pollinations.ai/prompt/a%20red%20fort%20at%20sunset?width=768&height=512&seed=7&model=flux&nologo=true&private=true&safe=true');
    expect(img.provider).toBe('Pollinations AI');
    expect(img.blob?.size).toBe(4);
    expect(img.url.startsWith('blob:')).toBe(true);
    m.releaseImage(img);
  });

  it('an empty or over-long prompt is refused before any request', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const m = await client();
    await expect(m.generateImage({ prompt: '   ' })).rejects.toMatchObject({ code: 'invalid-prompt' });
    await expect(m.generateImage({ prompt: 'x'.repeat(1001) })).rejects.toMatchObject({ code: 'invalid-prompt' });
    expect(f).not.toHaveBeenCalled();
  });

  it('a busy answer is retried, then the picture arrives; onRetry is told', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++n === 1 ? new Response('busy', { status: 503 }) : png())));
    const m = await client();
    const seen: number[] = [];
    vi.useFakeTimers();
    const p = m.generateImage({ prompt: 'tiger' }, { onRetry: (a: number) => seen.push(a) });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toMatchObject({ provider: 'Pollinations AI' });
    expect(seen).toEqual([1]);
  });

  it('a refusal is final and says so in words; a non-image answer is not a picture', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })));
    const m = await client();
    await expect(m.generateImage({ prompt: 'tiger' }, { retries: 0 })).rejects.toMatchObject({ code: 'refused', retryable: false });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    await expect(m.generateImage({ prompt: 'tiger' }, { retries: 0 })).rejects.toMatchObject({ code: 'failed' });
  });

  it('a slow engine times out, and the message is about time', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: { signal: AbortSignal }) => new Promise((_r, rej) => {
      init.signal.addEventListener('abort', () => rej(new Error('aborted')));
    })));
    const m = await client();
    vi.useFakeTimers();
    const p = m.generateImage({ prompt: 'tiger' }, { timeoutMs: 1000, retries: 0 });
    const check = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1001);
    await check;
  });

  it('when the browser will not hand over the bytes, the picture is still shown (no download blob)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    class FakeImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(v: string) { if (v) queueMicrotask(() => this.onload?.()); } }
    vi.stubGlobal('Image', FakeImage);
    const m = await client();
    const img = await m.generateImage({ prompt: 'tiger', seed: 1 }, { retries: 0 });
    expect(img.blob).toBeNull();
    expect(img.url).toContain('https://image.pollinations.ai/prompt/tiger');
  });

  it('a stop from the user is a cancel, never retried', async () => {
    const f = vi.fn((_u: string, init: { signal: AbortSignal }) => new Promise((_r, rej) => {
      init.signal.addEventListener('abort', () => rej(new Error('aborted')));
    }));
    vi.stubGlobal('fetch', f);
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

describe('4 · the server engine: no key ⇒ Pollinations, a key ⇒ that provider, a key never leaks', () => {
  afterEach(() => vi.unstubAllGlobals());
  const server = () => load<Server>(generateImageAiIntegration({ server: true, react: false }).files['server/lib/imageAi.ts']!, 'server');
  const png = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } });

  it('no IMAGE_API_KEY: keyless Pollinations, no Authorization header, the picture comes back', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: { headers: Record<string, string> }) => { calls.push({ url: u, headers: init.headers }); return png(); }));
    const m = await server();
    const out = await m.handleImageRequest({ prompt: 'tiger', seed: 5 }, 'a', { IMAGE_PROVIDER: 'openai', IMAGE_MODEL: 'gpt-image-1' });
    expect(out.status).toBe(200);
    expect(out.headers['X-Image-Provider']).toBe('Pollinations AI');
    expect(calls[0]!.url).toBe('https://image.pollinations.ai/prompt/tiger?width=1024&height=1024&seed=5&model=flux&nologo=true&private=true&safe=true');
    expect(calls[0]!.headers).toEqual({});
  });

  it('IMAGE_PROVIDER=pollinations with a key: the keyed host, the key in a header, never in the address', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: { headers: Record<string, string> }) => { calls.push({ url: u, headers: init.headers }); return png(); }));
    const m = await server();
    await m.handleImageRequest({ prompt: 'tiger' }, 'b', { IMAGE_PROVIDER: 'pollinations', IMAGE_API_KEY: 'sk_secret' });
    expect(calls[0]!.url.startsWith('https://gen.pollinations.ai/image/tiger?')).toBe(true);
    expect(calls[0]!.url).not.toContain('sk_secret');
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
    const out = await m.handleImageRequest({ prompt: 'tiger' }, 'e', { IMAGE_API_KEY: 'sk-whose' });
    expect(out.status).toBe(500);
    expect(out.body).toEqual({ error: 'Image generation is not set up correctly on this server.', code: 'not-configured' });
    expect(f).not.toHaveBeenCalled();
    expect(JSON.stringify(err.mock.calls)).not.toContain('sk-whose');
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
    const up = await m.handleImageRequest({ prompt: 'tiger' }, 'g', {});
    expect(up.status).toBe(429);
    expect(up.headers['Retry-After']).toBe('12');
    vi.stubGlobal('fetch', vi.fn(async () => png()));
    const env = { IMAGE_RATE_PER_MINUTE: '2' };
    expect((await m.handleImageRequest({ prompt: 'a' }, 'h', env)).status).toBe(200);
    expect((await m.handleImageRequest({ prompt: 'a' }, 'h', env)).status).toBe(200);
    expect((await m.handleImageRequest({ prompt: 'a' }, 'h', env)).status).toBe(429);
    expect((await m.handleImageRequest({ prompt: '' }, 'i', {})).status).toBe(400);
    expect((await m.handleImageRequest(null, 'i', {})).status).toBe(400);
    err.mockRestore();
  });

  it('the Express-style route sends bytes for a picture and JSON for an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => png()));
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
