// A KEY IS NAMED BEFORE THE BUTTON FAILS (autopsy 303e8a6f, queue row Q-966).
//
// The report: "The image template says nothing about a key until Generate fails." The CLASS: when a built app's
// feature depends on a key the owner keeps in NavBharatAI's vault, the page got a "do it" call
// (window.NavAI.image) but no "can it be done here?" call — so a missing key could only be shown AFTER somebody
// pressed the button and it failed, and NO_FAKE_FEATURE_RULE ("until it is saved render a clearly visible RED
// line … on that screen") could not be met by our own template, let alone by a builder.
//
// The fix adds the question — `NavAI.imageReady()` — in the preview shim and the published stamp, answered from
// ONE vault lookup (appAiImage.ts `ownerImageKey`), and the recipe's engine, hook and the AI-image template read
// it before the first Generate. Locked here:
//   §1 the CLASS census: every NavAI capability that needs an owner key has its readiness question, in BOTH shims;
//   §2 the preview shim (and the whole preview bridge it rides in): asks the parent, says "not here" at once,
//      and gives up after a bound — the old bundled phone client that never answers;
//   §3 the published stamp: only a well-formed answer resolves; everything else rejects (= unknown, never ready);
//   §4 the owner's route: owner-only, the owner's message, no counter, no provider, no cache; ONE vault lookup;
//   §5 the published route: the same visitor sentence as the picture route in every state, no vendor, a cache
//      reached only by a token whose signature verified;
//   §6 the recipe engine and hook: every answer mapped, an OLD stamp is "unknown", a hang is "unknown";
//   §7 the template, rendered: the line is on screen BEFORE any click, a visitor's Generate is off, shown once;
//   §7b the CLASS census over generated code: a picture screen without readiness fails;
//   §8 a readiness line is never read as an app error by the build's own browser check;
//   §9 the builder is told.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import vm from 'node:vm';
import { mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build, transformSync, type Plugin } from 'esbuild';

const vault = vi.hoisted(() => ({ secrets: {} as Record<string, string>, reads: 0 }));
const usage = vi.hoisted(() => ({ callsToday: 0, record: 0 }));
const registry = vi.hoisted(() => ({ rec: null as null | Record<string, unknown>, reads: 0 }));
const deploys = vi.hoisted(() => ({ rec: null as null | Record<string, unknown> }));
const auth = vi.hoisted(() => ({ uid: null as string | null }));

vi.mock('../src/server/lib/secrets', async (orig) => ({
  ...(await orig<typeof import('../src/server/lib/secrets')>()),
  loadUserVaultSecrets: vi.fn(async () => { vault.reads += 1; return vault.secrets; }),
}));
vi.mock('../src/server/lib/AppAiUsageStore', () => ({
  appAiUsageStore: {
    callsToday: vi.fn(async () => { usage.callsToday += 1; return { appCalls: 0, visitorCalls: 0, known: true }; }),
    record: vi.fn(async () => { usage.record += 1; }),
  },
}));
vi.mock('../src/server/lib/AppAiRegistryStore', () => ({
  appAiRegistryStore: { get: vi.fn(async () => { registry.reads += 1; return registry.rec; }) },
}));
vi.mock('../src/server/AgentV3/DeploymentStore', async (orig) => ({
  ...(await orig<typeof import('../src/server/AgentV3/DeploymentStore')>()),
  deploymentStore: { get: vi.fn(async () => deploys.rec) },
}));
vi.mock('../src/server/lib/authMiddleware', async (orig) => ({
  ...(await orig<typeof import('../src/server/lib/authMiddleware')>()),
  verifyFirebaseToken: vi.fn(async () => auth.uid),
}));
vi.mock('../src/lib/authHeaders', () => ({ authJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer owner' })) }));

import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { registerAppAiRoutes } from '../src/server/routes/appAi';
import { registerAppAiOwnerRoutes, PREVIEW_IMAGE_READY_PATH } from '../src/server/routes/appAiOwner';
import {
  gatewayScriptHtml, mintAppAiToken, visitorFacingMessage, IMAGE_GATEWAY_PATH, IMAGE_READY_GATEWAY_PATH,
} from '../src/server/lib/appAiGateway';
import {
  previewAiShimSource, readPreviewAiImageReadyAsk, PREVIEW_AI_IMAGE_READY_ASK, PREVIEW_AI_IMAGE_READY_ANSWER,
  PREVIEW_AI_IMAGE_READY_TIMEOUT_MS,
} from '../src/lib/previewAiProtocol';
import { previewBridgeSource } from '../src/server/AgentV3/previewBridge';
import { answerPreviewAiImageReady } from '../src/components/agentv3/previewAiRelay';
import { needsImageKeyMessage, VISITOR_IMAGE_UNAVAILABLE, APP_IMAGE_KEY_OPTIONS } from '../src/server/lib/appImageKeyOptions';
import { workspacePrefixFor } from '../src/server/lib/workspaceIdentity';
import { generateImageAiIntegration } from '../src/server/lib/ImageAiGenerator';
import { IMAGE_IN_APP_RULE } from '../src/server/AgentV3/inAppImageGeneration';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';
import { visibleAppError } from '../src/server/AgentV3/visibleAppError';
import { findAll, textOf, toHtml, type HostNode } from './helpers/hookRuntime';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const TMP = join(ROOT, 'tests', `.tmp-key-before-button-${process.pid}`);
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 5; i++) await tick(); };

type Fn = (...a: unknown[]) => unknown;
type NavAILike = Record<string, unknown> & { imageReady?: () => Promise<{ ready: boolean; here?: boolean; message: string }> };

// ── Running the two shims ───────────────────────────────────────────────────────────────────────────

/** The preview shim (or the whole preview bridge) in a sandbox, with or without a parent page to answer. */
function runPreview(src: string, opts: { parent?: boolean } = {}) {
  const sent: unknown[] = [];
  const listeners: Array<(e: unknown) => void> = [];
  const parent = { postMessage: (m: unknown) => { sent.push(m); } };
  const win: Record<string, unknown> = {
    addEventListener: (t: string, fn: (e: unknown) => void) => { if (t === 'message') listeners.push(fn); },
    matchMedia: () => ({ matches: false }),
  };
  win.window = win;
  win.parent = opts.parent === false ? win : parent;
  win.top = win.parent;
  const ctx = vm.createContext({
    window: win, setTimeout, Date, Promise, String, Error,
    // What the rest of the bridge touches while it loads.
    console: { log() {}, info() {}, warn() {}, error() {} },
    document: { addEventListener() {}, readyState: 'loading', styleSheets: [], documentElement: { classList: { contains: () => false } } },
    history: { pushState() {}, replaceState() {} },
    location: { pathname: '/', search: '', hash: '', protocol: 'https:' },
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
  });
  vm.runInContext(src, ctx);
  const answer = (data: unknown, source: unknown = parent) => { for (const fn of listeners) fn({ source, data }); };
  return { nav: win.NavAI as Record<string, Fn>, sent, answer };
}

/** The published stamp in a sandbox, with a fake network. */
function runStamp(fetchImpl: (url: string, init: { method: string; body: string }) => Promise<unknown>) {
  const html = gatewayScriptHtml('app1', 'tok-1', 'https://navbharatai.com/');
  const src = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  const win: Record<string, unknown> = {};
  vm.runInContext(src, vm.createContext({ window: win, JSON, fetch: fetchImpl, setTimeout }));
  return win.NavAI as Record<string, Fn>;
}

const functionsOf = (o: Record<string, unknown>) => Object.keys(o).filter((k) => typeof o[k] === 'function').sort();

// ── §1 ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every function on window.NavAI, and what it needs. A capability that runs on a key the OWNER keeps in
 * NavBharatAI's vault must have a readiness question beside it, so the page can say "not set up yet" BEFORE a
 * press fails. A new capability fails this census until it is classified here.
 */
const NAVAI_METHODS: Record<string, { ownerKey: false; why: string } | { ownerKey: true; readiness: string } | { readinessFor: string }> = {
  ask: { ownerKey: false, why: 'the text assistant runs on NavBharatAI\'s engine and the owner\'s wallet; an own key is optional' },
  image: { ownerKey: true, readiness: 'imageReady' },
  imageReady: { readinessFor: 'image' },
};

describe('§1 · the class: every NavAI capability that needs an owner key can be asked about first — in both shims', () => {
  const preview = functionsOf(runPreview(previewAiShimSource()).nav);
  const published = functionsOf(runStamp(async () => ({ json: async () => ({}) })));

  it('the preview shim and the published stamp expose the same capabilities', () => {
    expect(preview).toEqual(published);
  });

  it('every capability is classified, and every owner-key capability has its readiness question in both', () => {
    for (const name of [...new Set([...preview, ...published])]) {
      const c = NAVAI_METHODS[name];
      expect(c, `window.NavAI.${name} is not classified in NAVAI_METHODS`).toBeTruthy();
      if (c && 'ownerKey' in c && c.ownerKey) {
        expect(preview, `${name} → ${c.readiness} (preview)`).toContain(c.readiness);
        expect(published, `${name} → ${c.readiness} (published)`).toContain(c.readiness);
      }
    }
  });
});

// ── §2 ──────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · the preview shim asks its parent, says "not here" at once, and never waits forever', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('asks the parent and resolves the owner\'s answer', async () => {
    const { nav, sent, answer } = runPreview(previewAiShimSource());
    const p = nav.imageReady!() as Promise<unknown>;
    const ask = readPreviewAiImageReadyAsk(sent[0]);
    expect(ask).toMatchObject({ id: expect.any(String) });
    expect(sent[0]).toEqual({ [PREVIEW_AI_IMAGE_READY_ASK]: true, id: ask!.id });
    // An answer from anyone but the parent is ignored.
    answer({ [PREVIEW_AI_IMAGE_READY_ANSWER]: true, id: ask!.id, ok: true, ready: true }, { postMessage() {} });
    answer({ [PREVIEW_AI_IMAGE_READY_ANSWER]: true, id: ask!.id, ok: true, ready: false, message: 'M' });
    await expect(p).resolves.toEqual({ ready: false, message: 'M' });
    const q = nav.imageReady!() as Promise<unknown>;
    answer({ [PREVIEW_AI_IMAGE_READY_ANSWER]: true, id: readPreviewAiImageReadyAsk(sent[1])!.id, ok: true, ready: true });
    await expect(q).resolves.toEqual({ ready: true, message: '' });
  });

  it('a refused or malformed answer REJECTS — the page reads that as unknown, never as ready', async () => {
    const { nav, sent, answer } = runPreview(previewAiShimSource());
    const p = nav.imageReady!() as Promise<unknown>;
    answer({ [PREVIEW_AI_IMAGE_READY_ANSWER]: true, id: readPreviewAiImageReadyAsk(sent[0])!.id, ok: false });
    await expect(p).rejects.toThrow();
    const q = nav.imageReady!() as Promise<unknown>;
    answer({ [PREVIEW_AI_IMAGE_READY_ANSWER]: true, id: readPreviewAiImageReadyAsk(sent[1])!.id, ok: true });
    await expect(q).rejects.toThrow();
  });

  it('with no parent (the build\'s own browser, a new tab) it says so at once — the same sentence image() uses — and asks nobody', async () => {
    const { nav, sent } = runPreview(previewAiShimSource(), { parent: false });
    const ready = await (nav.imageReady!() as Promise<{ ready: boolean; here: boolean; message: string }>);
    const imageError = await (nav.image!('a tiger') as Promise<string>).catch((e: Error) => e.message);
    expect(ready).toEqual({ ready: false, here: false, message: imageError });
    expect(imageError).toMatch(/inside NavBharatAI/);
    expect(sent).toEqual([]);
  });

  it('🔒 no answer at all (a phone app bundled before this existed) rejects after the bound, not before', async () => {
    vi.useFakeTimers();
    const { nav } = runPreview(previewAiShimSource());
    let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
    (nav.imageReady!() as Promise<unknown>).then(() => { settled = 'resolved'; }, () => { settled = 'rejected'; });
    await vi.advanceTimersByTimeAsync(PREVIEW_AI_IMAGE_READY_TIMEOUT_MS - 1);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe('rejected');
  });

  it.each(['live', 'in-browser'] as const)('🔒 the WHOLE %s preview bridge still runs, and its NavAI has imageReady', async (source) => {
    const { nav, sent, answer } = runPreview(previewBridgeSource(source));
    expect(typeof nav.imageReady).toBe('function');
    const p = nav.imageReady!() as Promise<unknown>;
    const ask = sent.map(readPreviewAiImageReadyAsk).find(Boolean);
    expect(ask).toBeTruthy();
    answer({ [PREVIEW_AI_IMAGE_READY_ANSWER]: true, id: ask!.id, ok: true, ready: true });
    await expect(p).resolves.toEqual({ ready: true, message: '' });
  });

  it('🔒 the shim stays ES5 (it rides in every preview of every app) and still holds no credential', () => {
    const src = previewAiShimSource();
    expect(src).not.toMatch(/=>|`|\blet\s|\bconst\s|\bclass\s/);
    expect(() => transformSync(src, { loader: 'js', target: 'es5' })).not.toThrow();
    expect(src).toMatch(/^\(function \(\) \{\n {2}if \(window\.NavAI\) return;/);
    expect(src).not.toMatch(/token|apiKey|Authorization|\/api\/|https?:\/\//i);
  });

  it('the parent\'s relay passes on only a checked answer (a server body is not the answer until it is checked)', async () => {
    const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
    const calls: Array<{ url: string; body: string }> = [];
    const spy = vi.fn(async (url: string, init: { body: string }) => { calls.push({ url, body: init.body }); return new Response(JSON.stringify({ ok: true, ready: false, message: 'M' })); });
    expect(await answerPreviewAiImageReady({ id: 'r1' }, 'ws1', spy as unknown as typeof fetch))
      .toEqual({ [PREVIEW_AI_IMAGE_READY_ANSWER]: true, id: 'r1', ok: true, ready: false, message: 'M' });
    expect(calls).toEqual([{ url: '/api/app-ai/preview-image-ready', body: JSON.stringify({ workspaceId: 'ws1' }) }]);
    expect(await answerPreviewAiImageReady({ id: 'r2' }, 'ws1', reply({ ok: true, ready: true })))
      .toEqual({ [PREVIEW_AI_IMAGE_READY_ANSWER]: true, id: 'r2', ok: true, ready: true });
    for (const bad of [reply({ ok: false, message: 'Sign in' }, 403), reply('<html>not found</html>', 404), reply({ ok: true }), reply({ ok: true, ready: 'yes' })]) {
      expect(await answerPreviewAiImageReady({ id: 'r3' }, 'ws1', bad)).toEqual({ [PREVIEW_AI_IMAGE_READY_ANSWER]: true, id: 'r3', ok: false });
    }
    expect(await answerPreviewAiImageReady({ id: 'r4' }, undefined, spy as unknown as typeof fetch)).toMatchObject({ ok: false });
    expect(readPreviewAiImageReadyAsk({ [PREVIEW_AI_IMAGE_READY_ASK]: true, id: '' })).toBeNull();
    expect(readPreviewAiImageReadyAsk({ [PREVIEW_AI_IMAGE_READY_ASK]: true, id: 'x'.repeat(65) })).toBeNull();
  });
});

// ── §3 ──────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the published stamp: a well-formed answer resolves, everything else rejects', () => {
  it('posts the token to the readiness route and resolves { ready, message }', async () => {
    const posts: Array<{ url: string; method: string; body: unknown }> = [];
    const nav = runStamp(async (url, init) => { posts.push({ url, method: init.method, body: JSON.parse(init.body) }); return { json: async () => ({ ok: true, ready: false, message: VISITOR_IMAGE_UNAVAILABLE }) }; });
    await expect(nav.imageReady!() as Promise<unknown>).resolves.toEqual({ ready: false, message: VISITOR_IMAGE_UNAVAILABLE });
    expect(posts).toEqual([{ url: `https://navbharatai.com${IMAGE_READY_GATEWAY_PATH}`, method: 'POST', body: { token: 'tok-1' } }]);
    const ok = runStamp(async () => ({ json: async () => ({ ok: true, ready: true }) }));
    await expect(ok.imageReady!() as Promise<unknown>).resolves.toEqual({ ready: true, message: '' });
  });

  it.each([
    ['a body that is not JSON', async () => ({ json: async () => { throw new SyntaxError('Unexpected token <'); } })],
    ['a refusal', async () => ({ json: async () => ({ ok: false, message: 'Rate limit exceeded' }) })],
    ['no ready field', async () => ({ json: async () => ({ ok: true }) })],
    ['no network', async () => { throw new TypeError('Failed to fetch'); }],
  ])('🔒 %s rejects (unknown) — never a fake "ready"', async (_name, f) => {
    const nav = runStamp(f as (url: string, init: { method: string; body: string }) => Promise<unknown>);
    await expect(nav.imageReady!() as Promise<unknown>).rejects.toThrow();
  });
});

// ── §4 / §5: the routes ─────────────────────────────────────────────────────────────────────────────

const SECRET = 'q966-test-secret';
const OWNER = 'owner1';
const WS = `${workspacePrefixFor(OWNER)}sess1`;
const KEY = { OPENAI_API_KEY: 'sk-openai-0123456789abcdef' };
const savedEnv = { ...process.env };
let providerFetch: ReturnType<typeof vi.fn>;

function resetWorld(): void {
  process.env.APP_AI_GATEWAY = 'on';
  process.env.SECRET_ENCRYPTION_KEY = SECRET;
  vault.secrets = {}; vault.reads = 0;
  usage.callsToday = 0; usage.record = 0;
  registry.rec = { appId: 'app1', workspaceId: WS, userId: OWNER, nonce: 'n1' }; registry.reads = 0;
  deploys.rec = { url: 'https://app1.example.com', status: 'active', userId: OWNER };
  auth.uid = null;
  providerFetch = vi.fn(async () => { throw new Error('a provider was called'); });
  vi.stubGlobal('fetch', providerFetch);
}

async function call(routes: Map<string, (req: unknown, res: unknown) => unknown>, key: string, body: unknown) {
  const res = mockRes();
  await routes.get(key)!(mockReq({ body, headers: { 'user-agent': 'test' } }), res);
  return res;
}

describe('§4 · the owner\'s preview route: owner only, the owner\'s words, nothing spent, nothing cached', () => {
  beforeEach(resetWorld);
  afterEach(() => { process.env = { ...savedEnv }; vi.unstubAllGlobals(); });
  const routes = () => captureRoutes(registerAppAiOwnerRoutes) as Map<string, (req: unknown, res: unknown) => unknown>;

  it('a caller who does not own the workspace is refused', async () => {
    for (const uid of [null, 'someone-else']) {
      auth.uid = uid;
      const res = await call(routes(), `POST ${PREVIEW_IMAGE_READY_PATH}`, { workspaceId: WS });
      expect(res.statusCode).toBe(403);
      expect(res.body).toMatchObject({ ok: false });
    }
    expect(vault.reads).toBe(0);
  });

  it('no key ⇒ the owner\'s full message (which keys, where, where to paste); a key saved ⇒ ready on the very next check', async () => {
    auth.uid = OWNER;
    const r = routes();
    const first = await call(r, `POST ${PREVIEW_IMAGE_READY_PATH}`, { workspaceId: WS });
    expect(first.body).toEqual({ ok: true, ready: false, code: 'needs-key', message: needsImageKeyMessage() });
    expect(first.headers['cache-control']).toBe('no-store');
    vault.secrets = KEY;
    const second = await call(r, `POST ${PREVIEW_IMAGE_READY_PATH}`, { workspaceId: WS });
    expect(second.body).toEqual({ ok: true, ready: true });
    expect(vault.reads).toBe(2);
  });

  it('🔒 no picture counter, no wallet record and no provider is ever touched', async () => {
    auth.uid = OWNER;
    for (const secrets of [{}, KEY, { NAVBHARATAI_API_KEY: 'nbai_0123456789abcdef' }]) {
      vault.secrets = secrets;
      await call(routes(), `POST ${PREVIEW_IMAGE_READY_PATH}`, { workspaceId: WS });
    }
    expect(usage.callsToday).toBe(0);
    expect(usage.record).toBe(0);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('🔒 the source census: the vault key lookup lives in ONE function, read by both the picture and the readiness path', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(join(ROOT, d))) { const p = `${d}/${n}`; if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) files.push(p); } };
    walk('src/server');
    const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const callers = files.filter((f) => f !== 'src/server/lib/appImageKeys.ts' && /\bappImageKeyFromSecrets\(/.test(code(f)));
    expect(callers).toEqual(['src/server/lib/appAiImage.ts']);
    const lib = code('src/server/lib/appAiImage.ts');
    expect(lib.match(/\bappImageKeyFromSecrets\(/g)).toHaveLength(1);
    expect(lib.match(/\bloadUserVaultSecrets\(/g)).toHaveLength(1);
    const body = (fn: string) => lib.slice(lib.indexOf(fn), lib.indexOf('\n}', lib.indexOf(fn)));
    expect(body('async function ownerImageKey(')).toContain('appImageKeyFromSecrets(');
    expect(body('export async function imageForApp(')).toContain('ownerImageKey(');
    expect(body('export async function appImageReadiness(')).toContain('ownerImageKey(');
    for (const route of ['src/server/routes/appAi.ts', 'src/server/routes/appAiOwner.ts']) {
      expect(code(route), route).not.toMatch(/\bappImageKeyFromSecrets\(|\bloadUserVaultSecrets\(/);
    }
  });
});

describe('§5 · the published route: the picture route\'s own sentence in every state, no vendor, a bounded cache', () => {
  beforeEach(resetWorld);
  afterEach(() => { process.env = { ...savedEnv }; vi.unstubAllGlobals(); vi.useRealTimers(); });
  const routes = () => captureRoutes(registerAppAiRoutes) as Map<string, (req: unknown, res: unknown) => unknown>;
  const token = () => mintAppAiToken('app1', SECRET, 'n1');

  const STATES: Array<[string, () => string, () => string]> = [
    ['the gateway is switched off', () => { process.env.APP_AI_GATEWAY = 'off'; return token(); }, () => VISITOR_IMAGE_UNAVAILABLE],
    ['a forged token', () => mintAppAiToken('app1', 'not-our-secret', 'n1'), () => visitorFacingMessage('bad-token')],
    ['a token from two publishes ago', () => { registry.rec = { ...registry.rec, nonce: 'n9', prevNonce: 'n8' }; return token(); }, () => visitorFacingMessage('bad-token')],
    ['no registry row', () => { registry.rec = null; return token(); }, () => visitorFacingMessage('bad-token')],
    ['the app is unpublished', () => { deploys.rec = { url: '', status: 'deleted' }; return token(); }, () => visitorFacingMessage('not-live')],
    ['no image key is saved', () => token(), () => VISITOR_IMAGE_UNAVAILABLE],
  ];

  it.each(STATES)('%s: readiness says exactly what the picture route says', async (_state, arrange, expected) => {
    const t = arrange();
    const picture = await call(routes(), `POST ${IMAGE_GATEWAY_PATH}`, { token: t, prompt: 'a tiger' });
    const ready = await call(routes(), `POST ${IMAGE_READY_GATEWAY_PATH}`, { token: t });
    expect(picture.body).toEqual({ ok: false, message: expected() });
    expect(ready.body).toEqual({ ok: true, ready: false, message: expected() });
  });

  it('a saved key ⇒ ready, with nothing else in the answer', async () => {
    vault.secrets = KEY;
    const res = await call(routes(), `POST ${IMAGE_READY_GATEWAY_PATH}`, { token: token() });
    expect(res.body).toEqual({ ok: true, ready: true });
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('🔒 White-Label Law: no answer in any state names a vendor, a key or a secret', async () => {
    const forbidden = APP_IMAGE_KEY_OPTIONS.flatMap((o) => [o.provider, o.secret, ...o.aliases, o.label])
      .concat(['openai', 'gemini', 'grok', 'xai', 'pollinations', 'chatgpt', 'stability']);
    for (const [, arrange] of STATES) {
      resetWorld();
      const res = await call(routes(), `POST ${IMAGE_READY_GATEWAY_PATH}`, { token: arrange() });
      const text = JSON.stringify(res.body);
      for (const word of forbidden) expect(text.toLowerCase(), word).not.toContain(word.toLowerCase());
      expect(text).not.toMatch(/\bkeys?\b|secret/i);
    }
  });

  it('🔒 nothing is spent: no counter, no wallet record, no provider', async () => {
    for (const secrets of [{}, KEY]) {
      vault.secrets = secrets;
      await call(routes(), `POST ${IMAGE_READY_GATEWAY_PATH}`, { token: token() });
    }
    expect(usage.callsToday).toBe(0);
    expect(usage.record).toBe(0);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('🔒 one answer per token for a minute: two checks inside 60 s cost one database round, the next minute reads again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
    const r = routes();
    await call(r, `POST ${IMAGE_READY_GATEWAY_PATH}`, { token: token() });
    vault.secrets = KEY; // saved meanwhile — the cached answer may lag by up to a minute (documented)
    const cached = await call(r, `POST ${IMAGE_READY_GATEWAY_PATH}`, { token: token() });
    expect(cached.body).toEqual({ ok: true, ready: false, message: VISITOR_IMAGE_UNAVAILABLE });
    expect(vault.reads).toBe(1);
    expect(registry.reads).toBe(1);
    vi.setSystemTime(new Date('2026-10-13T10:01:01Z'));
    const fresh = await call(r, `POST ${IMAGE_READY_GATEWAY_PATH}`, { token: token() });
    expect(fresh.body).toEqual({ ok: true, ready: true });
    expect(vault.reads).toBe(2);
  });

  it('🔒 a forged token never reaches the cache or the database', async () => {
    const r = routes();
    const forged = mintAppAiToken('app1', 'not-our-secret', 'n1');
    for (let i = 0; i < 3; i++) await call(r, `POST ${IMAGE_READY_GATEWAY_PATH}`, { token: forged });
    expect(registry.reads).toBe(0);
    expect(vault.reads).toBe(0);
  });
});

// ── The generated code: transpile and run it ────────────────────────────────────────────────────────

async function load<T>(source: string, name: string): Promise<T> {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  mkdirSync(TMP, { recursive: true });
  const file = join(TMP, `${name}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, js);
  return import(pathToFileURL(file).href) as Promise<T>;
}

interface Engine {
  imageReadiness(): Promise<Record<string, unknown>>;
  readinessAfterError(e: unknown): Record<string, unknown> | null;
  ImageGenError: new (code: string, message: string, retryable: boolean) => Error;
}
const browserEngine = () => load<Engine>(generateImageAiIntegration({ server: false, react: false }).files['src/lib/imageAi.ts']!, 'engine');
const serverEngine = () => load<Engine>(generateImageAiIntegration({ server: true, react: false }).files['src/lib/imageAi.ts']!, 'engine-server');

describe('§6 · the recipe engine maps every answer, and an OLD page is "unknown"', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const image = vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo=');

  it('opened outside NavBharatAI (no NavAI) ⇒ unavailable, with the sentence that says where pictures are made', async () => {
    vi.stubGlobal('NavAI', undefined);
    const r = await (await browserEngine()).imageReadiness();
    expect(r).toMatchObject({ state: 'unavailable', message: expect.stringContaining('Pictures are made through NavBharatAI') });
  });

  it('🔒 backward compatibility: a page stamped before imageReady existed ⇒ unknown (no line, Generate on — today\'s behaviour)', async () => {
    vi.stubGlobal('NavAI', { image });
    expect(await (await browserEngine()).imageReadiness()).toEqual({ state: 'unknown' });
  });

  it('the answers: ready, needs-key (owner in the preview, not on the published app), not here, malformed, refused', async () => {
    const m = await browserEngine();
    const as = async (navAI: NavAILike) => { vi.stubGlobal('NavAI', navAI); return m.imageReadiness(); };
    expect(await as({ image, imageReady: async () => ({ ready: true, message: '' }) })).toEqual({ state: 'ready' });
    expect(await as({ image, preview: true, imageReady: async () => ({ ready: false, message: 'M' }) })).toEqual({ state: 'needs-key', message: 'M', owner: true });
    expect(await as({ image, imageReady: async () => ({ ready: false, message: 'V' }) })).toEqual({ state: 'needs-key', message: 'V', owner: false });
    expect(await as({ image, preview: true, imageReady: async () => ({ ready: false, here: false, message: 'Open it inside' }) })).toEqual({ state: 'unavailable', message: 'Open it inside' });
    expect(await as({ image, imageReady: async () => ({ ready: false, message: '' }) })).toEqual({ state: 'unknown' });
    expect(await as({ image, imageReady: async () => ({ ready: 'yes' } as never) })).toEqual({ state: 'unknown' });
    expect(await as({ image, imageReady: async () => { throw new Error('no'); } })).toEqual({ state: 'unknown' });
    expect(image).not.toHaveBeenCalled();
  });

  it('🔒 an answer that never comes ⇒ unknown after 15 s', async () => {
    const m = await browserEngine();
    vi.stubGlobal('NavAI', { image, imageReady: () => new Promise(() => undefined) });
    vi.useFakeTimers();
    let out: unknown = 'pending';
    void m.imageReadiness().then((r) => { out = r; });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(out).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(out).toEqual({ state: 'unknown' });
  });

  it('a failed picture with "needs-key" says the same thing; any other failure says nothing about readiness', async () => {
    const m = await browserEngine();
    vi.stubGlobal('NavAI', { image, preview: true });
    expect(m.readinessAfterError(new m.ImageGenError('needs-key', 'M', false))).toEqual({ state: 'needs-key', message: 'M', owner: true });
    expect(m.readinessAfterError(new m.ImageGenError('timeout', 'slow', true))).toBeNull();
    expect(m.readinessAfterError(new Error('x'))).toBeNull();
  });

  it('server mode asks the app\'s own route with a GET, and an older server (404, an HTML page) is unknown', async () => {
    const m = await serverEngine();
    const calls: Array<{ url: string; method: string }> = [];
    const answer = (res: Response) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: { method: string }) => { calls.push({ url, method: init.method }); return res; }));
    answer(new Response(JSON.stringify({ ready: false, code: 'needs-key', message: 'S' }), { status: 200 }));
    expect(await m.imageReadiness()).toEqual({ state: 'needs-key', message: 'S', owner: false });
    expect(calls).toEqual([{ url: '/api/generate-image', method: 'GET' }]);
    answer(new Response(JSON.stringify({ ready: true }), { status: 200 }));
    expect(await m.imageReadiness()).toEqual({ state: 'ready' });
    answer(new Response('Cannot GET /api/generate-image', { status: 404 }));
    expect(await m.imageReadiness()).toEqual({ state: 'unknown' });
    answer(new Response('<!doctype html><html></html>', { status: 200 }));
    expect(await m.imageReadiness()).toEqual({ state: 'unknown' });
  });

  interface Server {
    imageKeyReady(env: Record<string, string>): { ready: boolean; code?: string; message?: string };
    imageReadyRoute(): (req: unknown, res: { status(c: number): unknown; setHeader(n: string, v: string): unknown; json(b: unknown): unknown; send(b: unknown): unknown }) => void;
  }
  it('the app\'s own server answers from its settings alone — no log line, no network, and never the key', async () => {
    const s = await load<Server>(generateImageAiIntegration({ server: true, react: false }).files['server/lib/imageAi.ts']!, 'server-module');
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(s.imageKeyReady({})).toMatchObject({ ready: false, code: 'needs-key', message: expect.stringContaining('Keys & Secrets') });
    expect(s.imageKeyReady({ OPENAI_API_KEY: 'sk-own-0123' })).toEqual({ ready: true });
    expect(s.imageKeyReady({ IMAGE_API_KEY: 'sk_pollinations_secret' })).toEqual({ ready: true });
    const odd = s.imageKeyReady({ IMAGE_API_KEY: 'whose-key-is-this-0123' });
    expect(odd).toMatchObject({ ready: false, code: 'not-configured' });
    expect(JSON.stringify(odd)).not.toContain('whose-key-is-this-0123');
    expect(err).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
    const seen: Record<string, unknown> = {};
    s.imageReadyRoute()({}, { status: (c) => { seen.status = c; }, setHeader: (n, v) => { seen[n] = v; }, json: (b) => { seen.body = b; }, send: () => undefined });
    expect(seen).toMatchObject({ status: 200, 'Cache-Control': 'no-store', body: { ready: expect.any(Boolean) } });
    err.mockRestore();
  });
});

// ── §7: the template, rendered (the real App.tsx, hook and engine, on a minimal hook runtime) ──────────

const HOOK_RUNTIME = join(ROOT, 'tests/helpers/hookRuntime.ts');

interface Bundle {
  App: () => unknown;
  useImageGenerator: () => Record<string, unknown>;
  mount: (c: () => unknown) => { tree: () => Array<HostNode | string>; unmount: () => void };
}

/** Bundle a scaffold's App.tsx with its own engine files, React replaced by the hook runtime. */
async function bundleScaffold(files: Record<string, string>): Promise<Bundle> {
  const mem: Plugin = {
    name: 'scaffold-in-memory',
    setup(b) {
      b.onResolve({ filter: /^react(?:\/jsx-runtime|\/jsx-dev-runtime)?$/ }, () => ({ path: HOOK_RUNTIME }));
      b.onResolve({ filter: /^entry$/ }, () => ({ path: 'entry.ts', namespace: 'mem' }));
      b.onResolve({ filter: /^\.\.?\//, namespace: 'mem' }, (a) => {
        const base = posix.normalize(posix.join(posix.dirname(a.importer), a.path));
        for (const ext of ['', '.ts', '.tsx']) if (files[base + ext] !== undefined) return { path: base + ext, namespace: 'mem' };
        return { errors: [{ text: `cannot resolve ${a.path} from ${a.importer}` }] };
      });
      b.onLoad({ filter: /.*/, namespace: 'mem' }, (a) => ({
        contents: a.path === 'entry.ts'
          ? "export { default as App } from './src/App';\nexport { useImageGenerator } from './src/lib/useImageGenerator';\nexport { mount } from 'react';\n"
          : files[a.path]!,
        loader: a.path.endsWith('x') ? 'tsx' : 'ts',
        resolveDir: ROOT,
      }));
    },
  };
  const out = await build({ entryPoints: ['entry'], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', plugins: [mem], logLevel: 'silent' });
  mkdirSync(TMP, { recursive: true });
  const file = join(TMP, `scaffold-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, out.outputFiles[0]!.text);
  return import(pathToFileURL(file).href) as Promise<Bundle>;
}

const aiImage = GOLDEN_SCAFFOLDS.find((g) => g.id === 'ai-image')!;

describe('§7 · the AI-image template says it BEFORE anyone presses Generate', () => {
  let app: Bundle;
  const docListeners: Record<string, Array<() => void>> = {};
  beforeEach(async () => {
    app ??= await bundleScaffold(goldenScaffoldFiles(aiImage));
    for (const k of Object.keys(docListeners)) delete docListeners[k];
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      documentElement: { setAttribute() {}, removeAttribute() {} },
      addEventListener: (t: string, fn: () => void) => { (docListeners[t] ??= []).push(fn); },
      removeEventListener: (t: string, fn: () => void) => { docListeners[t] = (docListeners[t] ?? []).filter((x) => x !== fn); },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const screen = (navAI: NavAILike | undefined) => {
    vi.stubGlobal('NavAI', navAI);
    const m = app.mount(app.App);
    const tree = () => m.tree();
    const one = (pred: (n: HostNode) => boolean) => findAll(tree(), pred)[0]!;
    return {
      ...m,
      text: () => textOf(tree()),
      html: () => toHtml(tree()),
      notice: () => findAll(tree(), (n) => n.props.role === 'status' && String(n.props.className).includes('alert-danger')),
      type: (prompt: string) => (one((n) => n.type === 'textarea').props.onChange as Fn)({ target: { value: prompt } }),
      generateDisabled: () => one((n) => n.type === 'button' && n.props.type === 'submit').props.disabled === true,
      submit: () => (one((n) => n.type === 'form').props.onSubmit as Fn)({ preventDefault() {} }),
    };
  };
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;

  it('🔴 303e8a6f: a visitor with no key saved sees the line BEFORE any press, Generate is off, and nothing was asked to make a picture', async () => {
    const image = vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo=');
    const s = screen({ image, imageReady: async () => ({ ready: false, message: VISITOR_IMAGE_UNAVAILABLE }) });
    expect(s.notice()).toHaveLength(0); // still asking: nothing yet
    await flush();
    expect(s.notice()).toHaveLength(1);
    expect(textOf(s.notice())).toBe(VISITOR_IMAGE_UNAVAILABLE);
    s.type('a tiger');
    expect(s.generateDisabled()).toBe(true);
    expect(image).not.toHaveBeenCalled();
    s.unmount();
  });

  it('the owner, in the preview, reads the key list before any press — and Generate stays on to try again', async () => {
    const s = screen({ image: vi.fn(), preview: true, imageReady: async () => ({ ready: false, message: needsImageKeyMessage() }) });
    await flush();
    expect(textOf(s.notice())).toBe(needsImageKeyMessage());
    s.type('a tiger');
    expect(s.generateDisabled()).toBe(false);
    s.unmount();
  });

  it('a saved key ⇒ no line; an OLD page with no imageReady ⇒ no line and Generate on (today\'s behaviour)', async () => {
    for (const navAI of [{ image: vi.fn(), imageReady: async () => ({ ready: true, message: '' }) }, { image: vi.fn() }]) {
      const s = screen(navAI);
      await flush();
      expect(s.notice()).toHaveLength(0);
      s.type('a tiger');
      expect(s.generateDisabled()).toBe(false);
      s.unmount();
    }
  });

  it('opened outside NavBharatAI ⇒ the line says where pictures are made, and Generate stays on', async () => {
    const s = screen(undefined);
    await flush();
    expect(textOf(s.notice())).toContain('Pictures are made through NavBharatAI');
    s.type('a tiger');
    expect(s.generateDisabled()).toBe(false);
    s.unmount();
  });

  it('after a "needs-key" failure the message is on screen exactly once', async () => {
    const fail = vi.fn(async () => { throw Object.assign(new Error(needsImageKeyMessage()), { code: 'needs-key' }); });
    for (const imageReady of [async () => ({ ready: false, message: needsImageKeyMessage() }), undefined]) {
      const s = screen({ image: fail, preview: true, ...(imageReady ? { imageReady } : {}) });
      await flush();
      s.type('a tiger');
      s.submit();
      await flush();
      expect(count(s.text(), 'This app makes pictures with an AI image service')).toBe(1);
      s.unmount();
    }
  });

  it('the line goes when a picture is made, and a visitor\'s page asks again when it comes back into view', async () => {
    const s = screen({ image: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='), preview: true, imageReady: async () => ({ ready: false, message: 'M' }) });
    await flush();
    expect(s.notice()).toHaveLength(1);
    s.type('a tiger');
    s.submit();
    await flush();
    expect(s.notice()).toHaveLength(0);
    s.unmount();

    let saved = false;
    const imageReady = vi.fn(async () => (saved ? { ready: true, message: '' } : { ready: false, message: VISITOR_IMAGE_UNAVAILABLE }));
    const v = screen({ image: vi.fn(), imageReady });
    await flush();
    expect(v.notice()).toHaveLength(1);
    saved = true;
    for (const fn of docListeners.visibilitychange ?? []) fn();
    await flush();
    expect(v.notice()).toHaveLength(0);
    expect(imageReady).toHaveBeenCalledTimes(2);
    for (const fn of docListeners.visibilitychange ?? []) fn(); // ready now: no further asks
    await flush();
    expect(imageReady).toHaveBeenCalledTimes(2);
    v.unmount();
    expect(docListeners.visibilitychange ?? []).toHaveLength(0);
  });
});

describe('§7b · the class, over generated code: a picture screen without readiness fails', () => {
  const MAKES_PICTURES = /\buseImageGenerator\(|\bgenerateImage\(|NavAI\.image\(/;
  // READ, not merely named: a destructured `readiness` nothing looks at shows no line.
  const READS_READINESS = /\breadiness\.(?:state|message|owner)\b|\bimageReadiness\(/;
  const sources: Array<[string, Record<string, string>]> = [
    ...GOLDEN_SCAFFOLDS.map((g) => [`scaffold ${g.id}`, goldenScaffoldFiles(g)] as [string, Record<string, string>]),
    ...[false, true].map((server) => [`recipe server=${server}`, generateImageAiIntegration({ server, react: true }).files] as [string, Record<string, string>]),
  ];

  it('every file that makes pictures also reads readiness', () => {
    const missing: string[] = [];
    let found = 0;
    for (const [where, files] of sources) {
      for (const [path, content] of Object.entries(files)) {
        if (!/\.(tsx?|jsx?)$/.test(path) || !MAKES_PICTURES.test(content)) continue;
        found += 1;
        if (!READS_READINESS.test(content)) missing.push(`${where} ${path}`);
      }
    }
    expect(found).toBeGreaterThanOrEqual(3); // a census that finds nothing proves nothing
    expect(missing).toEqual([]);
  });
});

// ── §8 ──────────────────────────────────────────────────────────────────────────────────────────────

describe('§8 · a readiness line is never read as the app showing an error (the build\'s own browser check)', () => {
  let app: Bundle;
  beforeEach(async () => {
    app ??= await bundleScaffold(goldenScaffoldFiles(aiImage));
    vi.stubGlobal('document', { visibilityState: 'visible', documentElement: { setAttribute() {}, removeAttribute() {} }, addEventListener() {}, removeEventListener() {} });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const rendered = async (navAI: NavAILike | undefined, act?: (tree: () => Array<HostNode | string>) => void) => {
    vi.stubGlobal('NavAI', navAI);
    const m = app.mount(app.App);
    await flush();
    if (act) { act(m.tree); await flush(); }
    const html = toHtml(m.tree());
    m.unmount();
    return html;
  };

  it('every sentence the line can show passes — and the same markup with a failure sentence is caught', async () => {
    const noParent = await (runPreview(previewAiShimSource(), { parent: false }).nav.imageReady!() as Promise<{ message: string }>);
    const server = await load<{ imageKeyReady(env: Record<string, string>): { message?: string } }>(generateImageAiIntegration({ server: true, react: false }).files['server/lib/imageAi.ts']!, 'server-module-8');
    const lines = [
      needsImageKeyMessage(), VISITOR_IMAGE_UNAVAILABLE, visitorFacingMessage('bad-token'), visitorFacingMessage('not-live'),
      noParent.message, server.imageKeyReady({}).message!, server.imageKeyReady({ IMAGE_API_KEY: 'whose-0123' }).message!,
    ];
    for (const line of lines) {
      const html = await rendered({ image: vi.fn(), imageReady: async () => ({ ready: false, message: line }) });
      expect(html, line).toContain('alert-danger');
      expect(visibleAppError(html), line).toBeNull();
    }
    const outside = await rendered(undefined);
    expect(outside).toContain('Pictures are made through NavBharatAI');
    expect(visibleAppError(outside)).toBeNull();
    // The control: the check is real for this very markup.
    const failing = await rendered({ image: vi.fn(), imageReady: async () => ({ ready: false, message: 'The picture maker could not be reached.' }) });
    expect(visibleAppError(failing)).not.toBeNull();
  });
});

// ── §9 ──────────────────────────────────────────────────────────────────────────────────────────────

describe('§9 · the builder is told to show readiness before the first Generate', () => {
  it('the rule every builder reads, the recipe\'s instructions in both modes, and the tool description', () => {
    expect(IMAGE_IN_APP_RULE).toMatch(/readiness[^.]*BEFORE the\s+first Generate/);
    for (const server of [false, true]) {
      const text = generateImageAiIntegration({ server, react: true }).instructions;
      expect(text, `server=${server}`).toContain('BEFORE the first Generate, show readiness');
      expect(text, `server=${server}`).toContain('imageReadiness()');
      expect(text, `server=${server}`).toContain('alert alert-danger');
    }
    expect(generateImageAiIntegration({ server: true, react: true }).instructions).toContain("app.get('/api/generate-image', imageReadyRoute())");
    const tool = defaultToolCatalog().find((t) => t.name === 'generate_image_ai')!;
    expect(tool.description).toContain('useImageGenerator().readiness');
  });
});
