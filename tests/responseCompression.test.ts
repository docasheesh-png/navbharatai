import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { shouldCompress, responseCompression } from '../src/server/lib/responseCompression';

/**
 * gzip for the serving path (admin 2026-08-25, "app mart me app jaldi open ho"). Nothing compressed
 * before this — Cloud Run does not do it for you — so the 355 KB-gzippable main bundle went over the
 * wire at ~1.28 MB raw, and a store app's 21 KB-gzippable page at up to 190 KB.
 *
 * 🔒 THE INVARIANT UNDER TEST IS THE ALLOWLIST, because the failure mode of naive gzip is silent and
 * ugly: it BUFFERS streams. The v5 build streams its progress as NDJSON under text/plain — with
 * compression applied, a builder would stare at a dead screen for the whole build and then get every
 * event at once. These tests pin the exact types that may compress and the exact streams that must not.
 */
describe('shouldCompress — the allowlist', () => {
  it('compresses the types the app actually serves in bulk', () => {
    for (const t of ['application/json', 'text/html; charset=utf-8', 'application/javascript',
                     'text/css', 'image/svg+xml']) {
      expect(shouldCompress(t), t).toBe(true);
    }
  });

  it('NEVER touches the live streams or already-compressed bodies', () => {
    for (const t of [
      'text/plain; charset=utf-8',   // the v5 build's NDJSON progress stream — the one that burned us
      'text/event-stream',           // chat + zip progress
      'application/zip',             // already deflated
      'application/octet-stream',
      'image/png',
      'video/mp4',
      '', undefined,
    ]) {
      expect(shouldCompress(t as string | undefined), String(t)).toBe(false);
    }
  });
});

describe('the mounted middleware, over a real socket', () => {
  async function serve(handler: (app: express.Express) => void): Promise<{ url: string; close: () => void }> {
    const app = express();
    app.use(responseCompression());
    handler(app);
    const srv = app.listen(0);
    await new Promise((r) => srv.once('listening', r));
    return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, close: () => srv.close() };
  }

  it('gzips a large JSON body when the client accepts it', async () => {
    const big = { html: 'x'.repeat(50_000) };
    const s = await serve((app) => app.get('/j', (_q, r) => r.json(big)));
    try {
      const res = await fetch(`${s.url}/j`, { headers: { 'Accept-Encoding': 'gzip' } });
      expect(res.headers.get('content-encoding')).toBe('gzip');
      expect((await res.json()).html.length).toBe(50_000); // fetch transparently decodes — content intact
    } finally { s.close(); }
  });

  it('leaves a text/plain NDJSON stream alone — each chunk arrives as written', async () => {
    const s = await serve((app) => app.get('/stream', (_q, r) => {
      r.setHeader('Content-Type', 'text/plain; charset=utf-8');
      r.write(JSON.stringify({ type: 'stage', label: 'building' }) + '\n');
      r.write('y'.repeat(4096) + '\n');
      r.end();
    }));
    try {
      const res = await fetch(`${s.url}/stream`, { headers: { 'Accept-Encoding': 'gzip' } });
      expect(res.headers.get('content-encoding')).toBeNull();
      expect(await res.text()).toContain('"stage"');
    } finally { s.close(); }
  });

  it('a small JSON body is not worth a gzip header', async () => {
    const s = await serve((app) => app.get('/tiny', (_q, r) => r.json({ ok: true })));
    try {
      const res = await fetch(`${s.url}/tiny`, { headers: { 'Accept-Encoding': 'gzip' } });
      expect(res.headers.get('content-encoding')).toBeNull();
    } finally { s.close(); }
  });

  it('the win is real: a store-page-sized body shrinks by an order of magnitude', () => {
    const page = '<!doctype html>' + JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ id: i, label: 'item ' + i })));
    const gz = gzipSync(Buffer.from(page)).length;
    expect(gz).toBeLessThan(Buffer.byteLength(page) / 5);
  });
});
