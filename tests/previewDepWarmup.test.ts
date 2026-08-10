import { describe, it, expect, afterEach } from 'vitest';
import {
  extractMirrorImports, crawlDepGraph, startDepWarmup, getWarmDepUrls, warmupKey,
  WARMUP_MAX_MODULES, _setWarmupFetchForTests, _clearWarmupForTests,
} from '../src/server/runtime/PreviewDepWarmup';
import { buildWarmPreloads, buildReactPreview, MAX_WARM_PRELOADS } from '../src/server/runtime/ReactPreview';
import { fetchMirroredModule, sharedMirrorCache } from '../src/server/routes/esmMirror';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

/**
 * PREVIEW WARMUP (admin 2026-08-08: "Bolt me preview turant load ho jata hai, hamare me nahi").
 * The measured bottleneck was a two-level waterfall: chunk imports discovered one parse at a time
 * on mobile RTT, against a mirror cache that dies on every deploy. The invariants here: the server
 * crawl warms the SAME cache the route serves, the discovered graph becomes full-page preloads,
 * bounds hold against pathological graphs, and the cold path stays byte-identical to today.
 */

const js = (body: string) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/javascript; charset=utf-8' },
  arrayBuffer: async () => new TextEncoder().encode(body).buffer,
});

afterEach(() => {
  _setWarmupFetchForTests(null);
  _clearWarmupForTests();
});

describe('extractMirrorImports', () => {
  it('finds every mirror-relative import, deduped, order kept — and nothing else', () => {
    const body = `import a from "/api/esm/react@18.3.1?dev";
      import "/api/esm/chunk-abc.mjs"; import b from "/api/esm/react@18.3.1?dev";
      import x from "https://other.cdn/pkg"; const s = '/not/mirror';`;
    expect(extractMirrorImports(body)).toEqual([
      '/api/esm/react@18.3.1?dev',
      '/api/esm/chunk-abc.mjs',
    ]);
  });
});

describe('crawlDepGraph', () => {
  it('BFS-discovers entries then chunks, fetching each module exactly once', async () => {
    const fetched: string[] = [];
    _setWarmupFetchForTests(async (path) => {
      fetched.push(path);
      const bodies: Record<string, string> = {
        'react-dom@18.3.1': 'import "/api/esm/chunk-a.mjs"; import "/api/esm/react@18.3.1";',
        'react@18.3.1': 'export default 1;',
        'chunk-a.mjs': 'import "/api/esm/chunk-b.mjs";',
        'chunk-b.mjs': 'export {};',
      };
      return { ok: true, body: Buffer.from(bodies[path] ?? 'export {};'), contentType: 'application/javascript' };
    });
    const urls = await crawlDepGraph(['/api/esm/react-dom@18.3.1', '/api/esm/react@18.3.1']);
    expect(urls).toEqual([
      '/api/esm/react-dom@18.3.1',
      '/api/esm/react@18.3.1',
      '/api/esm/chunk-a.mjs',
      '/api/esm/chunk-b.mjs',
    ]);
    // Each module pulled through the mirror pipeline once — the crawl IS the warming.
    expect(fetched.sort()).toEqual(['chunk-a.mjs', 'chunk-b.mjs', 'react-dom@18.3.1', 'react@18.3.1']);
  });

  it('bounds hold: a self-multiplying graph stops at WARMUP_MAX_MODULES', async () => {
    _setWarmupFetchForTests(async (path) => {
      const n = Number(path.replace(/\D/g, '') || 0);
      const kids = [1, 2, 3].map((k) => `"/api/esm/m${n * 10 + k}.mjs"`).join(';import ');
      return { ok: true, body: Buffer.from(`import ${kids};`), contentType: 'application/javascript' };
    });
    const urls = await crawlDepGraph(['/api/esm/m1.mjs']);
    expect(urls.length).toBeLessThanOrEqual(WARMUP_MAX_MODULES);
  });

  it('a failing module is a SKIP, never a crash — the rest of the graph still warms', async () => {
    _setWarmupFetchForTests(async (path) =>
      path === 'bad.mjs'
        ? { ok: false, status: 502 }
        : { ok: true, body: Buffer.from('export {};'), contentType: 'application/javascript' });
    const urls = await crawlDepGraph(['/api/esm/bad.mjs', '/api/esm/good.mjs']);
    expect(urls).toContain('/api/esm/good.mjs');
    expect(urls).toContain('/api/esm/bad.mjs'); // still preloadable — the browser's own retry may succeed
  });
});

describe('memoized warmup + sync lookup', () => {
  it('startDepWarmup crawls ONCE per dependency set; getWarmDepUrls turns non-null after', async () => {
    let crawls = 0;
    _setWarmupFetchForTests(async () => {
      crawls++;
      return { ok: true, body: Buffer.from('export {};'), contentType: 'application/javascript' };
    });
    const entries = ['/api/esm/react@18.3.1'];
    expect(getWarmDepUrls(entries)).toBeNull(); // cold
    startDepWarmup(entries);
    startDepWarmup(entries); // dedupe: in-flight
    await new Promise((r) => setTimeout(r, 20));
    expect(getWarmDepUrls(entries)).toEqual(entries);
    startDepWarmup(entries); // dedupe: memo
    expect(crawls).toBe(1);
  });

  it('esm.sh-direct URLs (mirror off) warm nothing and look up nothing', () => {
    startDepWarmup(['https://esm.sh/react@18.3.1']);
    expect(getWarmDepUrls(['https://esm.sh/react@18.3.1'])).toBeNull();
  });

  it('warmupKey is order-independent — the same deps are one crawl regardless of map order', () => {
    expect(warmupKey(['/api/esm/a', '/api/esm/b'])).toBe(warmupKey(['/api/esm/b', '/api/esm/a']));
  });
});

describe('buildWarmPreloads', () => {
  it('emits a preload per discovered module — mirror-relative or http(s) only, escaped, capped', () => {
    const tags = buildWarmPreloads([
      '/api/esm/react@18.3.1?dev&target=es2020',
      '/api/esm/chunk-a.mjs',
      'javascript:alert(1)',   // must never be emitted
      '/api/esm/chunk-a.mjs',  // dupe
    ]);
    expect(tags).toContain('href="/api/esm/react@18.3.1?dev&amp;target=es2020"');
    expect(tags).toContain('href="/api/esm/chunk-a.mjs"');
    expect(tags).not.toContain('javascript:');
    expect(tags.match(/<link /g)?.length).toBe(2);
    const many = buildWarmPreloads(Array.from({ length: 300 }, (_, i) => `/api/esm/m${i}.mjs`));
    expect(many.match(/<link /g)?.length).toBe(MAX_WARM_PRELOADS);
  });
});

describe('the shared cache is genuinely shared (warming warms the route)', () => {
  it('fetchMirroredModule fills the SAME store the /api/esm route reads by default', async () => {
    // Both default to sharedMirrorCache — a warmup into a private cache would warm nothing.
    const probe = 'shared-probe-pkg@1.0.0';
    let upstreamCalls = 0;
    const fetchImpl = async () => { upstreamCalls++; return js('export default 42;'); };
    const first = await fetchMirroredModule(probe, { fetchImpl: fetchImpl as never });
    expect(first.ok).toBe(true);
    const second = await fetchMirroredModule(probe, { fetchImpl: fetchImpl as never });
    expect(second.ok).toBe(true);
    expect(upstreamCalls).toBe(1); // second hit came from sharedMirrorCache
    expect(sharedMirrorCache.get(probe)).toBeTruthy();
  });

  it('the route registration defaults to the shared cache (source invariant)', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '..', 'src/server/routes/esmMirror.ts'), 'utf8');
    const at = src.indexOf('export function registerEsmMirrorRoutes');
    expect(src.slice(at, at + 400)).toContain('opts?.cache ?? sharedMirrorCache');
    // And there is exactly ONE fetch pipeline — the route must call the extracted function.
    expect(src.slice(at)).toContain('fetchMirroredModule(path + query');
  });
});

describe('the page uses the warm graph when ready, and is unchanged when cold', () => {
  const APP = {
    'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
    'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
    'src/main.tsx': "import React from 'react';\nimport { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')!).render(<div/>);",
  };

  it('cold: byte-identical preload behavior to today (top-level importmap preloads)', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord(APP), 'https://navbharatai.com');
    expect(html).toContain('rel="modulepreload"');
    expect(html).not.toContain('chunk-'); // no invented chunks when nothing is warmed
  });

  it('warm: the page ships the FULL discovered graph as preloads (chunks included)', async () => {
    _setWarmupFetchForTests(async (path) => ({
      ok: true,
      body: Buffer.from(path.startsWith('react-dom') ? 'import "/api/esm/chunk-client.mjs";' : 'export {};'),
      contentType: 'application/javascript',
    }));
    // First render kicks the crawl…
    buildReactPreview(VirtualFileSystem.fromRecord(APP), 'https://navbharatai.com');
    await new Promise((r) => setTimeout(r, 30));
    // …the next render ships the full set — this is what collapses the mobile waterfall.
    const html = buildReactPreview(VirtualFileSystem.fromRecord(APP), 'https://navbharatai.com');
    expect(html).toContain('href="/api/esm/chunk-client.mjs"');
  });
});
