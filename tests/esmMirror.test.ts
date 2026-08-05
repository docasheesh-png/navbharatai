import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import {
  registerEsmMirrorRoutes, rewriteAbsoluteImports, isSafeMirrorPath, MirrorCache,
} from '../src/server/routes/esmMirror';
import { buildReactPreview } from '../src/server/runtime/ReactPreview';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

/**
 * Same-origin dependency mirror (Bolt-parity slice 2). The promise under test: a preview's npm
 * modules are served from OUR origin with immutable caching, so reopening an old app needs no CDN —
 * and the mirror can only ADD reliability, because the loader's later rungs still go direct.
 */

// ---------- rewriteAbsoluteImports: the part that must never be wrong ----------

describe('rewriteAbsoluteImports', () => {
  it('rewrites static, re-export and dynamic-import specifiers that are absolute paths', async () => {
    const body = 'import a from"/v135/a.mjs";export*from"/v135/b.mjs";const p=import("/v135/c.mjs");';
    const out = await rewriteAbsoluteImports(body);
    expect(out).toContain('"/api/esm/v135/a.mjs"');
    expect(out).toContain('"/api/esm/v135/b.mjs"');
    expect(out).toContain('"/api/esm/v135/c.mjs"');
  });

  it('NEVER touches a string literal that merely contains a path — the regex trap this parser avoids', async () => {
    const body = 'import a from"/v135/a.mjs";const route="/v135/fake";const msg="see /v135/docs";';
    const out = await rewriteAbsoluteImports(body);
    expect(out).toContain('const route="/v135/fake"');
    expect(out).toContain('see /v135/docs');
    expect(out).toContain('"/api/esm/v135/a.mjs"');
  });

  it('leaves relative, bare, protocol-relative and full-URL specifiers alone', async () => {
    const body = 'import a from"./x.mjs";import b from"react";import c from"//cdn.example/x";import d from"https://esm.sh/y";';
    expect(await rewriteAbsoluteImports(body)).toBe(body);
  });

  it('serves an unparseable body unmodified rather than corrupting it', async () => {
    const body = 'this is ] not javascript at all';
    expect(await rewriteAbsoluteImports(body)).toBe(body);
  });
});

// ---------- path validation ----------

describe('isSafeMirrorPath', () => {
  it('accepts real esm.sh shapes', () => {
    for (const p of ['react@18.3.1', 'react-dom@18.3.1/client', '@mui/material@5.0.0', 'v135/react@18.3.1/es2022/react.mjs']) {
      expect(isSafeMirrorPath(p), p).toBe(true);
    }
  });
  it('rejects traversal, schemes, and junk', () => {
    for (const p of ['../etc/passwd', 'a/../../b', 'http://evil.com/x', 'a\\b', 'a b', '', 'x'.repeat(700), '/leading']) {
      expect(isSafeMirrorPath(p), JSON.stringify(p)).toBe(false);
    }
  });
});

// ---------- the LRU bound ----------

describe('MirrorCache', () => {
  it('evicts oldest entries to stay under the byte budget', () => {
    const cache = new MirrorCache(100, 60);
    cache.set('a', { body: Buffer.alloc(40), contentType: 'x' });
    cache.set('b', { body: Buffer.alloc(40), contentType: 'x' });
    cache.get('a');                                            // refresh a — b is now oldest
    cache.set('c', { body: Buffer.alloc(40), contentType: 'x' });
    expect(cache.get('b')).toBeUndefined();                    // evicted
    expect(cache.get('a')).toBeDefined();
    expect(cache.totalBytes).toBeLessThanOrEqual(100);
  });
  it('refuses entries over the per-entry cap instead of evicting everything for one giant', () => {
    const cache = new MirrorCache(100, 60);
    cache.set('big', { body: Buffer.alloc(90), contentType: 'x' });
    expect(cache.size).toBe(0);
  });
});

// ---------- the route, end to end against a mock upstream ----------

let server: Server;
let baseUrl: string;
let upstreamCalls: string[] = [];

beforeAll(async () => {
  const app = express();
  const fetchImpl = async (url: string) => {
    upstreamCalls.push(url);
    if (url.includes('missing')) {
      return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const body = Buffer.from('import x from"/v135/chunk.mjs";export default x;', 'utf8');
    return {
      ok: true, status: 200,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/javascript; charset=utf-8' : null) },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };
  registerEsmMirrorRoutes(app, { fetchImpl });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('/api/esm mirror route', () => {
  it('serves a module with immutable caching + CORS + rewritten internal imports', async () => {
    const res = await fetch(`${baseUrl}/api/esm/react@18.3.1?external=react,react-dom`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('content-type')).toContain('javascript');
    const body = await res.text();
    expect(body).toContain('"/api/esm/v135/chunk.mjs"');       // internal chunk stays inside the mirror
  });

  it('serves the second request from cache — upstream is contacted once per URL+query', async () => {
    upstreamCalls = [];
    await fetch(`${baseUrl}/api/esm/axios@1.6.0`);
    await fetch(`${baseUrl}/api/esm/axios@1.6.0`);
    expect(upstreamCalls.length).toBe(1);
    // A different query is a DIFFERENT module on esm.sh — it must not share a cache entry.
    await fetch(`${baseUrl}/api/esm/axios@1.6.0?external=react`);
    expect(upstreamCalls.length).toBe(2);
    expect(upstreamCalls[1]).toContain('?external=react');
  });

  it('passes upstream 404 through honestly so the loader falls to its next rung', async () => {
    const res = await fetch(`${baseUrl}/api/esm/missing-pkg@1.0.0`);
    expect(res.status).toBe(404);
  });

  it('refuses a traversal path outright', async () => {
    const res = await fetch(`${baseUrl}/api/esm/..%2F..%2Fetc%2Fpasswd`);
    expect(res.status).toBe(400);
  });
});

// ---------- the page actually uses the mirror ----------

describe('preview page + mirror integration', () => {
  const APP = {
    'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', axios: '^1.6.0' } }),
    'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
    'src/main.jsx': "import App from './App';\nexport default function boot(){ return App; }",
    'src/App.jsx': "export default function App(){ return <div>Hi</div>; }",
  };

  it('with a known origin, the importmap and preloads point at the same-origin mirror', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord(APP), 'https://navbharatai.com');
    expect(html).toContain('https://navbharatai.com/api/esm/react@18.3.1');
    expect(html).toContain('https://navbharatai.com/api/esm/axios@1.6.0?external=react,react-dom');
    expect(html).not.toContain('https://esm.sh/axios');        // the mirror IS the first rung now
    // #2132's preloads ride the same map, so they warm the mirror URLs.
    expect(html).toMatch(/<link rel="modulepreload" href="https:\/\/navbharatai\.com\/api\/esm\//);
    // The loader knows the real base, so the esm.run fallback still slices the version correctly.
    expect(html).toContain('var DEP_BASE = "https://navbharatai.com/api/esm/"');
  });

  it('without an origin, or with the kill switch, dependencies stay on plain esm.sh', () => {
    const noOrigin = buildReactPreview(VirtualFileSystem.fromRecord(APP));
    expect(noOrigin).toContain('https://esm.sh/react@18.3.1');
    expect(noOrigin).not.toContain('/api/esm/react');
    process.env.AGENTV3_PREVIEW_DEP_PROXY = 'off';
    try {
      const off = buildReactPreview(VirtualFileSystem.fromRecord(APP), 'https://navbharatai.com');
      expect(off).toContain('https://esm.sh/react@18.3.1');
      expect(off).not.toContain('/api/esm/react');
    } finally {
      delete process.env.AGENTV3_PREVIEW_DEP_PROXY;
    }
  });

  it('the escape hatch survives: the raw esm.sh and esm.run rungs remain in the loader', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord(APP), 'https://navbharatai.com');
    expect(html).toContain("var ESM = 'https://esm.sh/'");
    expect(html).toContain("var ESM_ALT = 'https://esm.run/'");
  });
});
