/**
 * The web bundle is compressed ONCE, at build time, not on every request (compression audit,
 * 2026-09-24). Measured on the real bundle: brotli-11 copies are 14% smaller than the quality-4
 * brotli the per-request middleware can afford, and they cost no CPU per request.
 *
 * Driven through a REAL Express app with the SAME middleware order as server.ts (the per-request
 * compressor, then the precompressed server, then express.static) over real HTTP.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { brotliCompressSync, gzipSync, brotliDecompressSync } from 'zlib';
import type { Server } from 'http';
import { pickEncoding, assetPathFor, precompressedStatic } from '../src/server/lib/precompressedStatic';
import { responseCompression } from '../src/server/lib/responseCompression';
import { cacheControlFor, UNHASHED_ASSET_CACHE } from '../src/server/lib/staticCache';

describe('pickEncoding', () => {
  it('prefers brotli, then gzip, and honours q=0 as a refusal', () => {
    expect(pickEncoding('gzip, deflate, br')).toBe('br');
    expect(pickEncoding('gzip, deflate')).toBe('gzip');
    expect(pickEncoding('br;q=0, gzip')).toBe('gzip');
    expect(pickEncoding('identity')).toBeNull();
    expect(pickEncoding(undefined)).toBeNull();
    expect(pickEncoding('*')).toBe('br');
  });
});

describe('assetPathFor', () => {
  it('only the three asset directories, never traversal', () => {
    expect(assetPathFor('/d', '/assets/index-1.js')).toBe('/d/assets/index-1.js');
    expect(assetPathFor('/d', '/index.html')).toBeNull();
    expect(assetPathFor('/d', '/server.cjs')).toBeNull();
    expect(assetPathFor('/d', '/assets/../server.cjs')).toBeNull();
    expect(assetPathFor('/d', '/assets/%2e%2e/server.cjs')).toBeNull();
    expect(assetPathFor('/d', '/assets/%E0%A4%A')).toBeNull();
  });
});

describe('the non-hashed Monaco and preview-runtime files are not pinned for a year', () => {
  it('a day, then revalidation — while hashed assets stay immutable', () => {
    expect(cacheControlFor('/app/dist/monaco/vs/loader.js')).toBe(UNHASHED_ASSET_CACHE);
    expect(cacheControlFor('/app/dist/vendor/babel.min.js')).toBe(UNHASHED_ASSET_CACHE);
    expect(cacheControlFor('/app/dist/assets/index-abc.js')).toBe('public, max-age=31536000, immutable');
  });
});

describe('over real HTTP, in server.ts order', () => {
  const js = 'export function hello(name){return "hello "+name}\n'.repeat(500);
  let dir = '';
  let server: Server;
  let base = '';

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'precompressed-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app-1.js'), js);
    writeFileSync(join(dir, 'assets', 'app-1.js.br'), brotliCompressSync(Buffer.from(js)));
    writeFileSync(join(dir, 'assets', 'app-1.js.gz'), gzipSync(Buffer.from(js)));
    writeFileSync(join(dir, 'assets', 'plain-2.js'), js); // no copies — the old path must serve it
    const app = express();
    app.use(responseCompression());
    app.use(precompressedStatic(dir));
    app.use(express.static(dir));
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  /** Raw bytes as sent — Node's fetch would decode, which would hide what went over the wire. */
  async function raw(path: string, ae: string) {
    const { request } = await import('http');
    return new Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }>((resolve, reject) => {
      request(`${base}${path}`, { headers: { 'accept-encoding': ae } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject).end();
    });
  }

  it('a brotli browser gets the ready-made .br copy, labelled as JavaScript, encoded once', async () => {
    const r = await raw('/assets/app-1.js', 'gzip, br');
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBe('br');
    expect(String(r.headers['content-type'])).toMatch(/javascript/);
    expect(String(r.headers['vary'])).toMatch(/Accept-Encoding/i);
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(r.body.equals(readFileSync(join(dir, 'assets', 'app-1.js.br')))).toBe(true);
    expect(brotliDecompressSync(r.body).toString()).toBe(js);
  });

  it('a gzip-only client gets the .gz copy', async () => {
    const r = await raw('/assets/app-1.js', 'gzip');
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(r.body.equals(readFileSync(join(dir, 'assets', 'app-1.js.gz')))).toBe(true);
  });

  it('a client that accepts nothing gets the plain file', async () => {
    const r = await raw('/assets/app-1.js', 'identity');
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(r.body.toString()).toBe(js);
  });

  it('a file with no copy falls through to the old per-request path, unchanged', async () => {
    const r = await raw('/assets/plain-2.js', 'br');
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBe('br'); // compressed by the middleware, as before
    expect(brotliDecompressSync(r.body).toString()).toBe(js);
  });
});

describe('source guards', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('server.ts mounts it before express.static', () => {
    const s = read('server.ts');
    expect(s.indexOf('app.use(precompressedStatic(distPath))')).toBeGreaterThan(0);
    expect(s.indexOf('app.use(precompressedStatic(distPath))')).toBeLessThan(s.indexOf('app.use(express.static(distPath'));
  });
  it('the Dockerfile precompresses; `npm run build` does not (Capacitor would ship the copies)', () => {
    expect(read('Dockerfile')).toMatch(/RUN node scripts\/precompress\.mjs dist/);
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.build).not.toMatch(/precompress/);
  });
});

describe('the static-site ZIP export is actually compressed', () => {
  it('asks JSZip for DEFLATE (its default, STORE, compresses nothing)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/ide/GitPanel.tsx'), 'utf8');
    expect(src).toMatch(/generateAsync\(\{ type: 'blob', compression: 'DEFLATE'/);
  });
});
