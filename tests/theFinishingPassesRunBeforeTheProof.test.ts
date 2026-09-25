/**
 * THE FINISHING PASSES RUN BEFORE THE PREVIEW PROOF — AND WHAT THE FREEZE HAD BEEN HIDING (2026-09-25).
 *
 * Four deterministic passes (E2E net, architecture note, unit-test skeletons, production defaults) ran
 * AFTER the app was latched green, so Green Freeze refused every one of them on every build that was
 * proven to work: "no tests" forever, and no PWA basics. The admin was offered three options and asked
 * which is best for "working app jaldi, aur app acche se acchi". They now run BEFORE the proof, so they
 * are part of what the browser checks and the production build compiles — and the freeze is not widened.
 *
 * Moving them exposed the second half: the generated service worker answered EVERY request cache-first
 * under a cache name that never changed, so a republished app never reached a returning visitor, and a
 * live preview could serve dev modules from before an edit. It is network-first now.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  planAppDefaults, upgradeGeneratedServiceWorker, LEGACY_SERVICE_WORKER_V1, SERVICE_WORKER_FILE,
} from '../src/server/AgentV3/appDefaults';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { buildSourceAppPreview } from '../src/lib/previewUtils';

const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const code = (src: string) => src.replace(/^\s*\/\/.*$/gm, '');

describe('ORDER: the four passes run before the app is latched green', () => {
  const src = code(ROUTE);
  const firstLatch = src.indexOf('latchGreen(workspaceId');
  const platformPreview = src.indexOf("'PLATFORM_PREVIEW_UP'");

  it.each([
    ['E2E net', 'planE2eScaffold('],
    ['architecture note', 'adrStore.record('],
    ['unit-test skeletons', 'planAutoTests('],
    ['production defaults', 'planAppDefaults('],
  ])('🔴 %s: after the platform starts the preview, before the first latch', (_name, marker) => {
    const at = src.indexOf(marker);
    expect(firstLatch).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(platformPreview); // the E2E decision reads whether a preview exists
    expect(at).toBeLessThan(firstLatch);         // REVERSION: behind the latch, the freeze refuses it
    expect(src.indexOf(marker, at + 1)).toBe(-1); // moved, not copied
  });

  it('the architecture note is awaited (bounded), so it cannot land after the latch by racing it', () => {
    const at = src.indexOf('adrStore.record(');
    const before = src.slice(src.lastIndexOf('if (result.ok && userId && writtenFiles.size > 0 && !isImportTurn)', at), at);
    expect(before).toContain('await withTimeout((async () => {');
  });

  it('the freeze itself is NOT widened', () => {
    const freeze = readFileSync('src/server/AgentV3/greenFreeze.ts', 'utf8');
    for (const pass of ['auto-test', 'app-defaults', 'e2e', 'adr', 'finishing']) {
      expect(freeze).not.toMatch(new RegExp(`^\\s*'[^']*${pass}[^']*',`, 'm'));
    }
  });
});

// ── A service worker, executed ────────────────────────────────────────────────────────────────────────

type Handler = (e: Record<string, unknown>) => void;
type Store = Map<string, Response>;
function runWorker(source: string, opts: { online: boolean; cached?: Record<string, Response | string>; oldCaches?: string[] }) {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Store>();
  for (const name of opts.oldCaches ?? []) stores.set(name, new Map());
  const store = (n: string) => { if (!stores.has(n)) stores.set(n, new Map()); return stores.get(n)!; };
  const urlOf = (r: Request | string | { url: string }) => (typeof r === 'string' ? new URL(r, 'https://app.test').href : r.url);
  const cacheApi = (n: string) => ({
    add: async (u: string) => { store(n).set(urlOf(u), new Response('shell')); },
    put: async (r: Request, res: Response) => { store(n).set(urlOf(r), res); },
    keys: async () => [...store(n).keys()].map((url) => ({ url })),
    delete: async (k: { url: string }) => store(n).delete(k.url),
  });
  const caches = {
    open: async (n: string) => cacheApi(n),
    match: async (r: Request | string) => {
      const u = urlOf(r);
      for (const m of stores.values()) if (m.has(u)) return m.get(u)!.clone();
      const c = opts.cached?.[u];
      return c === undefined ? undefined : typeof c === 'string' ? new Response(c) : c;
    },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
  };
  const fetchImpl = async (r: Request) => {
    if (!opts.online) throw new TypeError('offline');
    const res = new Response(`network:${new URL(r.url).pathname}`, { status: 200 });
    Object.defineProperty(res, 'type', { value: 'basic' }); // what a browser reports for a same-origin fetch
    return res;
  };
  const self = {
    location: { origin: 'https://app.test' },
    addEventListener: (t: string, h: Handler) => { handlers[t] = h; },
    skipWaiting: async () => {}, clients: { claim: async () => {} },
  };
  new Function('self', 'caches', 'fetch', 'Response', source)(self, caches, fetchImpl, Response);
  const respond = async (path: string, init: { mode?: string; destination?: string; origin?: string } = {}) => {
    let responded: Promise<Response> | null = null;
    const req = new Request((init.origin ?? 'https://app.test') + path);
    Object.defineProperty(req, 'mode', { value: init.mode ?? 'no-cors' });
    Object.defineProperty(req, 'destination', { value: init.destination ?? '' });
    handlers.fetch({ request: req, respondWith: (p: Promise<Response>) => { responded = p; } });
    return responded ? await (responded as Promise<Response>) : null;
  };
  const request = async (path: string, mode = 'no-cors', origin = 'https://app.test') => {
    const res = await respond(path, { mode, origin });
    if (!res) return null;
    return res.type === 'error' ? 'ERROR' : await res.text();
  };
  const lifecycle = async (t: 'install' | 'activate') => {
    let wait: Promise<unknown> = Promise.resolve();
    handlers[t]({ waitUntil: (p: Promise<unknown>) => { wait = p; } });
    await wait;
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { request, respond, lifecycle, stores, settle };
}

const V2 = planAppDefaults(null, 'App').files['sw.js'];

describe('the service worker: network first, cache only when offline', () => {
  it('🔴 online, a cached page is NOT served — the new version is (the republish that never arrived)', async () => {
    const w = runWorker(V2, { online: true, cached: { 'https://app.test/': 'OLD APP' } });
    expect(await w.request('/', 'navigate')).toBe('network:/');
  });

  it('REVERSION: the v1 worker serves the stale page while online — the bug, reproduced', async () => {
    const w = runWorker(LEGACY_SERVICE_WORKER_V1, { online: true, cached: { 'https://app.test/': 'OLD APP' } });
    expect(await w.request('/', 'navigate')).toBe('OLD APP');
  });

  it('offline: the cached copy is served, and a page with none falls back to the shell', async () => {
    const w = runWorker(V2, { online: false, cached: { 'https://app.test/assets/a.js': 'cached js' } });
    expect(await w.request('/assets/a.js')).toBe('cached js');
    await w.lifecycle('install'); // precaches '/', offline included in this fake
    expect(await w.request('/some/route', 'navigate')).toBe('shell');
    expect(await w.request('/missing.png')).toBe('ERROR'); // an honest network error, not a wrong file
  });

  it('dev-server modules and other origins are never intercepted (a live preview cannot go stale)', async () => {
    const w = runWorker(V2, { online: true });
    for (const p of ['/src/App.tsx', '/@vite/client', '/@react-refresh', '/node_modules/.vite/deps/react.js']) {
      expect(await w.request(p)).toBeNull();
    }
    expect(await w.request('/x.js', 'no-cors', 'https://cdn.example.com')).toBeNull();
  });

  it('activating deletes the old v1 cache — and never a cache the app itself made', async () => {
    const w = runWorker(V2, { online: true, oldCaches: ['app-shell-v1', 'my-app-offline-data'] });
    await w.lifecycle('install');
    await w.lifecycle('activate');
    expect([...w.stores.keys()].sort()).toEqual(['app-shell-v2', 'my-app-offline-data']);
  });

  it('pages and static files are cached; API and data responses never are', async () => {
    const w = runWorker(V2, { online: true });
    await w.respond('/', { mode: 'navigate' });
    await w.respond('/assets/index-abc.js', { destination: 'script' });
    await w.respond('/api/orders', { mode: 'navigate' });
    await w.respond('/data/me.json', { destination: '' });
    await w.settle(); await w.settle();
    expect([...(w.stores.get('app-shell-v2')?.keys() ?? [])].sort()).toEqual([
      'https://app.test/', 'https://app.test/assets/index-abc.js',
    ]);
  });

  it('the cache is bounded — hashed bundles from old versions do not pile up forever', async () => {
    const w = runWorker(V2, { online: true });
    for (let i = 0; i < 95; i++) { await w.respond(`/assets/chunk-${i}.js`, { destination: 'script' }); await w.settle(); }
    for (let i = 0; i < 5; i++) await w.settle();
    expect(w.stores.get('app-shell-v2')!.size).toBeLessThanOrEqual(80);
  });

  it('a cached redirect (a host that sends / to /index.html or back) still answers an offline page', async () => {
    const redirected = new Response('shell page');
    Object.defineProperty(redirected, 'redirected', { value: true });
    const w = runWorker(V2, { online: false, cached: { 'https://app.test/': redirected } });
    const res = await w.respond('/deep/link', { mode: 'navigate' });
    expect(res!.redirected).toBe(false);
    expect(await res!.text()).toBe('shell page');
  });
});

describe('our own old worker is replaced; anybody else\'s is not', () => {
  it('v1 → v2; an edited v1, a user worker and v2 itself → untouched', () => {
    expect(upgradeGeneratedServiceWorker(LEGACY_SERVICE_WORKER_V1)).toBe(V2);
    expect(upgradeGeneratedServiceWorker(LEGACY_SERVICE_WORKER_V1.replace(/\n/g, '\r\n') + '\n')).toBe(V2);
    expect(upgradeGeneratedServiceWorker(LEGACY_SERVICE_WORKER_V1 + '\n// mine')).toBeNull();
    expect(upgradeGeneratedServiceWorker("self.addEventListener('fetch', () => {});")).toBeNull();
    expect(upgradeGeneratedServiceWorker(V2)).toBeNull();
    expect(upgradeGeneratedServiceWorker(null)).toBeNull();
    expect(SERVICE_WORKER_FILE).toBe('sw.js');
  });

  it('the app name from the prompt is escaped in the document and the icon', () => {
    const r = planAppDefaults('<html><head></head><body></body></html>', 'Tom "&" <Jerry>');
    expect(r.indexHtml).toContain('<title>Tom &quot;&amp;&quot; &lt;Jerry&gt;</title>');
    expect(r.indexHtml).not.toContain('<Jerry>');
    expect(r.files['icon.svg']).toContain('aria-label="Tom &quot;&amp;&quot; &lt;Jerry&gt; icon"');
  });
});

describe('the generate_app_defaults tool: public/ for Vite, and the old worker upgraded', () => {
  class Act implements ActuatorPort {
    constructor(public files: Map<string, string>) {}
    async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
    async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
    async listFiles() { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
    async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
  }
  const run = async (files: Map<string, string>) => {
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(new Act(files), 'ws-1', new WorkspaceState(stream), stream);
    return String((await d.dispatch({ id: 't1', name: 'generate_app_defaults', input: { app_name: 'Shop' } }, 'architect')).content);
  };

  it('a Vite app gets its files under public/, where the production build ships them', async () => {
    const files = new Map([['vite.config.ts', 'export default {}'], ['index.html', '<html><head></head><body></body></html>']]);
    await run(files);
    for (const f of ['public/sw.js', 'public/manifest.webmanifest', 'public/robots.txt', 'public/icon.svg']) expect(files.has(f)).toBe(true);
    expect(files.has('sw.js')).toBe(false);
  });

  it('our legacy public/sw.js is upgraded; a user\'s own worker is left exactly as written', async () => {
    const legacy = new Map([['vite.config.ts', 'x'], ['public/sw.js', LEGACY_SERVICE_WORKER_V1]]);
    await run(legacy);
    expect(legacy.get('public/sw.js')).toBe(V2);
    const mine = "self.addEventListener('fetch', () => {}); // mine";
    const theirs = new Map([['vite.config.ts', 'x'], ['public/sw.js', mine]]);
    await run(theirs);
    expect(theirs.get('public/sw.js')).toBe(mine);
  });

  it('a non-Vite app keeps root paths', async () => {
    const files = new Map([['index.html', '<html><head></head><body></body></html>']]);
    await run(files);
    expect(files.has('sw.js')).toBe(true);
    expect(files.has('public/sw.js')).toBe(false);
  });
});

describe('the in-browser preview runs on OUR origin, so it drops the app\'s worker registration', () => {
  beforeEach(() => { (globalThis as { location?: unknown }).location = { origin: 'https://navbharatai.com' }; });
  afterEach(() => { delete (globalThis as { location?: unknown }).location; });

  it('the registration is removed; the app\'s other inline scripts stay', () => {
    const indexHtml = planAppDefaults(
      '<html><head></head><body><div id="root"></div><script>window.keepMe=1</script><script type="module" src="/src/main.jsx"></script></body></html>',
      'App',
    ).indexHtml!;
    expect(indexHtml).toContain('serviceWorker.register');
    const html = buildSourceAppPreview({
      'index.html': indexHtml,
      'package.json': '{}',
      'src/main.jsx': "import { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')).render('x');\n",
    });
    expect(html).not.toContain('serviceWorker.register');
    expect(html).toContain('window.keepMe=1');
  });
});

// ── The review's findings on the move, each locked ────────────────────────────────────────────────────

import { testSkeletonsCannotBreakTheBuild, buildTsconfigPath } from '../src/server/AgentV3/TestGenerationAgent';
import * as golden from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

describe('🔴 a test skeleton is written only where it cannot break the production build', () => {
  const pkg = (build: string | null, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ ...(build ? { scripts: { build } } : {}), ...extra });

  it('our own Vite scaffold is safe — its release config excludes tests', () => {
    expect(buildTsconfigPath(golden.packageJson)).toBe('tsconfig.build.json');
    expect(testSkeletonsCannotBreakTheBuild(golden.packageJson, golden.tsconfigBuild)).toBe(true);
  });

  it('a build that type-checks every file is not: next, vue-tsc, tsc -b, or a -p config that keeps tests', () => {
    for (const b of ['next build', 'vue-tsc && vite build', 'tsc -b && vite build', 'tsc && vite build', 'svelte-check && vite build']) {
      expect(testSkeletonsCannotBreakTheBuild(pkg(b), null)).toBe(false);
    }
    expect(testSkeletonsCannotBreakTheBuild(pkg('tsc -p tsconfig.app.json && vite build'), '{ "include": ["src"] }')).toBe(false);
    expect(testSkeletonsCannotBreakTheBuild(pkg('tsc -p tsconfig.app.json && vite build'), null)).toBe(false);
  });

  it('safe where the import resolves or nothing compiles the file', () => {
    expect(testSkeletonsCannotBreakTheBuild(pkg('next build', { devDependencies: { vitest: '^2' } }), null)).toBe(true);
    expect(testSkeletonsCannotBreakTheBuild(pkg('vite build'), null)).toBe(true);
    expect(testSkeletonsCannotBreakTheBuild(pkg(null), null)).toBe(true);
    expect(testSkeletonsCannotBreakTheBuild(null, null)).toBe(true);
    expect(testSkeletonsCannotBreakTheBuild('{ not json', null)).toBe(false);
  });

  it('WIRING: the route asks before it plans a skeleton', () => {
    const src = code(ROUTE);
    const ask = src.indexOf('testSkeletonsCannotBreakTheBuild(');
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(src.indexOf('planAutoTests('));
    expect(src).toContain('const plan = skeletonsSafe ? planAutoTests(');
  });
});

describe('the rest of the review, locked at the source', () => {
  const src = code(ROUTE);
  const block = src.slice(src.indexOf('const finishingPaths = new Set<string>()'), src.indexOf("process.env.AGENTV3_RENDER_RESCUE !== 'off'"));

  it('the live preview keeps its console bridge when index.html is patched; the saved source stays clean', () => {
    expect(block).toContain("hasPreviewBridge(sandboxIndex) ? injectPreviewBridge(defaults.indexHtml, 'live') : defaults.indexHtml");
    expect(block).toContain('writtenFiles.set(idxPath, defaults.indexHtml)');
  });

  it('every finishing write moves the in-build tick, so a concurrent proof cannot save a half-finished tree', () => {
    expect(block).toContain('const noteFinishingWrite = (path: string) => { finishingPaths.add(path); inBuildWriteTick++; }');
    const sets = block.match(/writtenFiles\.set\(/g)?.length ?? 0;
    const notes = block.match(/noteFinishingWrite\(/g)?.length ?? 0;
    expect(notes).toBe(sets); // one note per write
  });

  it('the reviewer is not sent to review our own finishing files', () => {
    expect(src).toContain('changedFiles: [...writtenFiles.keys()].filter((p) => !finishingPaths.has(p))');
  });
});

describe('the preview strip judges each script on its own', () => {
  beforeEach(() => { (globalThis as { location?: unknown }).location = { origin: 'https://navbharatai.com' }; });
  afterEach(() => { delete (globalThis as { location?: unknown }).location; });

  it('a stray "<script" earlier in the body cannot drag real markup away with the registration', () => {
    const body = '<div id="root"></div><p>use a &lt;script tag</p><!-- <script --><section id="keep">Hello</section>'
      + "<script>navigator.serviceWorker.register('/sw.js')</script>";
    const html = buildSourceAppPreview({
      'index.html': `<html><body>${body}<script type="module" src="/src/main.jsx"></script></body></html>`,
      'package.json': '{}',
      'src/main.jsx': "import { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')).render('x');\n",
    });
    expect(html).toContain('<section id="keep">Hello</section>');
  });
});

describe('a v1 worker the old tool left at the ROOT of a Vite app is upgraded too', () => {
  class Act implements ActuatorPort {
    constructor(public files: Map<string, string>) {}
    async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
    async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
    async listFiles() { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
    async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
  }
  it('tool path', async () => {
    const files = new Map([['package.json', '{"devDependencies":{"vite":"^5"}}'], ['sw.js', LEGACY_SERVICE_WORKER_V1]]);
    const stream = new AgentEventStream();
    await new ToolDispatcher(new Act(files), 'ws-1', new WorkspaceState(stream), stream)
      .dispatch({ id: 't1', name: 'generate_app_defaults', input: {} }, 'architect');
    expect(files.get('sw.js')).toBe(V2);
    expect(files.get('public/sw.js')).toBe(V2);
  });
  it('route path', () => {
    expect(code(ROUTE)).toContain('const upgraded = upgradeGeneratedServiceWorker(await actuator.readFile(workspaceId, rootSw)');
  });
});
