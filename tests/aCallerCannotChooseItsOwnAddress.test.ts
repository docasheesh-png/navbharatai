// Forensic audit 2026-10-04 — a caller must not be able to choose the address every per-IP limit keys on.
//
// `app.set('trust proxy', true)` made `req.ip` the LEFTMOST X-Forwarded-For entry — whatever the caller
// wrote — so a fresh header per request was a fresh "visitor" to the chat, payment and admin-login
// limiters, the adaptive bot guard, and the OTP / phone-exchange buckets. Five more places read the header
// by hand and took the same leftmost entry. These tests run a real Express app with the real setting and
// the real limiter, and a census keeps any new hand-rolled read out.

import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import rateLimit from 'express-rate-limit';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { clientAddress, trustedProxyHops, DEFAULT_TRUSTED_PROXY_HOPS, addressRateKey, identityRateKey } from '../src/server/lib/clientAddress';
import { requestAddress } from '../src/server/lib/guestDailyQuota';

const req = (xff: string | string[] | undefined, socket = '10.1.2.3') =>
  ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: socket } }) as never;

describe('clientAddress reads the entry the caller cannot write', () => {
  it('a spoofed leftmost entry is ignored — Cloud Run appended the real one last', () => {
    expect(clientAddress(req('6.6.6.6, 203.0.113.9'))).toBe('203.0.113.9');
    expect(clientAddress(req('1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.9'))).toBe('203.0.113.9');
  });

  it('with no header the socket is the caller', () => {
    expect(clientAddress(req(undefined))).toBe('10.1.2.3');
  });

  it('two trusted hops move the answer one entry left; zero trusts nothing but the socket', () => {
    expect(clientAddress(req('6.6.6.6, 203.0.113.9, 35.191.0.1'), 2)).toBe('203.0.113.9');
    expect(clientAddress(req('6.6.6.6, 203.0.113.9'), 0)).toBe('10.1.2.3');
  });

  it('a header split over several lines is one list', () => {
    expect(clientAddress(req(['6.6.6.6', '203.0.113.9']))).toBe('203.0.113.9');
  });

  it('the guest backstop reads the same address (one implementation)', () => {
    expect(requestAddress(req('6.6.6.6, 203.0.113.9'))).toBe(clientAddress(req('6.6.6.6, 203.0.113.9')));
  });

  it('TRUST_PROXY_HOPS: a hop count only — "true", negatives and junk fall back to one hop', () => {
    expect(trustedProxyHops(undefined)).toBe(DEFAULT_TRUSTED_PROXY_HOPS);
    expect(DEFAULT_TRUSTED_PROXY_HOPS).toBe(1);
    expect(trustedProxyHops('2')).toBe(2);
    expect(trustedProxyHops('0')).toBe(0);
    for (const bad of ['true', '-1', '1.5', '99', 'all', '']) expect(trustedProxyHops(bad)).toBe(1);
  });
});

describe('a real Express app with the server\'s setting and limiter', () => {
  const app = express();
  app.set('trust proxy', trustedProxyHops());
  const limiter = rateLimit({ windowMs: 60_000, max: 2, keyGenerator: (r) => addressRateKey(r), standardHeaders: true, legacyHeaders: false });
  // The server's identity key with a stub verifier: a token "good-<uid>" is that account, anything else is not.
  const verify = async (r: express.Request) => { const h = r.headers.authorization ?? ''; return h.startsWith('Bearer good-') ? h.slice(12) : null; };
  const idLimiter = rateLimit({ windowMs: 60_000, max: 2, keyGenerator: (r) => identityRateKey(r, verify), standardHeaders: true, legacyHeaders: false });
  app.get('/probe', limiter, (r, res) => { res.json({ ip: r.ip, ours: clientAddress(r) }); });
  app.get('/id', idLimiter, (_r, res) => { res.json({ ok: true }); });
  const server = app.listen(0);
  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  it('req.ip and clientAddress agree, and both ignore the spoofed entry', async () => {
    const r = await fetch(`${base()}/probe`, { headers: { 'x-forwarded-for': '6.6.6.6, 198.51.100.7' } });
    const body = await r.json() as { ip: string; ours: string };
    expect(body.ip).toBe('198.51.100.7');
    expect(body.ours).toBe('198.51.100.7');
  });

  it('rotating the spoofed entry does NOT reset the limit', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${base()}/probe`, { headers: { 'x-forwarded-for': `9.9.9.${i}, 192.0.2.44` } });
      codes.push(r.status);
    }
    expect(codes).toEqual([200, 200, 429, 429, 429]);
  });

  it('signed-in accounts behind ONE carrier address each get their own budget', async () => {
    const hit = (uid: string) => fetch(`${base()}/id`, { headers: { 'x-forwarded-for': '100.64.0.9', authorization: `Bearer good-${uid}` } }).then((r) => r.status);
    expect([await hit('alice'), await hit('alice'), await hit('alice')]).toEqual([200, 200, 429]);
    expect(await hit('bob')).toBe(200);
  });

  it('a forged token is not an identity — it falls back to the address and cannot mint buckets', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push(await fetch(`${base()}/id`, { headers: { 'x-forwarded-for': '100.64.0.77', authorization: `Bearer forged-${i}` } }).then((r) => r.status));
    }
    expect(codes).toEqual([200, 200, 429, 429]);
  });
});

/** Every server-side source file. */
function serverSources(): string[] {
  const out: string[] = ['server.ts'];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue; }
      if (/\.(ts|mjs|js)$/.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(p);
    }
  };
  walk('src/server');
  return out;
}

describe('census: one place decides the caller\'s address', () => {
  // Not this server's own request handling: a detector that names the pattern in USER apps, and a
  // generator whose route is emitted into a user's app (which sets its own `trust proxy`).
  const NOT_OUR_REQUESTS = new Set([
    join('src/server/lib/clientAddress.ts'),
    join('src/server/AgentV3/SecurityAnalysis.ts'),
    join('src/server/lib/PageViewsGenerator.ts'),
  ]);

  it('no server file reads X-Forwarded-For / X-Real-IP by hand', () => {
    const offenders: string[] = [];
    for (const f of serverSources()) {
      if (NOT_OUR_REQUESTS.has(f)) continue;
      const src = readFileSync(f, 'utf8');
      if (/headers\s*\[\s*['"`](?:x-forwarded-for|x-real-ip|cf-connecting-ip)['"`]\s*\]|\.get\(\s*['"`](?:x-forwarded-for|x-real-ip)['"`]/i.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('no limiter hands a REQUEST to ipKeyGenerator (it takes an address string)', () => {
    // Code lines only: the comments that record the incident quote the broken call on purpose.
    const code = (f: string) => readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    const offenders = serverSources().filter((f) => /ipKeyGenerator\(\s*req\b/.test(code(f)));
    expect(offenders).toEqual([]);
    const server = readFileSync('server.ts', 'utf8');
    expect(server).toMatch(/registerPreviewRoutes\(app, previewLimiter\)/);
  });

  it('nothing sets `trust proxy` to true', () => {
    const offenders = serverSources()
      .filter((f) => !NOT_OUR_REQUESTS.has(f))
      .filter((f) => /\.set\(\s*['"`]trust proxy['"`]\s*,\s*true\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
    expect(readFileSync('server.ts', 'utf8')).toMatch(/app\.set\('trust proxy', trustedProxyHops\(\)\)/);
  });
});
