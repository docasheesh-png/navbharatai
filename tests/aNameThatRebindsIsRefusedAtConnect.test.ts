// Q-617 (forensic audit 2026-10-04) — a user-supplied address is vetted when the socket connects.
//
// `assertPublicHttpUrl` resolved a name and vetted the answer, and then `fetch` resolved it AGAIN to
// connect. A name that answers "public" first and "169.254.169.254" second (DNS rebinding) walked past
// the check; a followed redirect to an IP literal was never checked at all. Every fetch of a
// user-supplied address now goes through a dispatcher that vets the address the connection actually uses.

import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { publicOnlyLookup, publicOnlyInit, SSRF_BLOCKED_CODE } from '../src/server/lib/ssrfGuard';

const secret = http.createServer((_q, r) => r.end('internal-secret')).listen(0, '127.0.0.1');
const port = () => (secret.address() as AddressInfo).port;
afterAll(() => new Promise<void>((done) => secret.close(() => done())));

const causeCode = async (url: string) => {
  try { await fetch(url, publicOnlyInit({})); return 'connected'; }
  catch (e) { return (e as { cause?: { code?: string } }).cause?.code ?? 'error'; }
};

describe('the connection itself refuses a private address', () => {
  it('an IP literal (Node connects with no lookup — the redirect-hop case)', async () => {
    expect(await causeCode(`http://127.0.0.1:${port()}/`)).toBe(SSRF_BLOCKED_CODE);
  });

  it('a name that resolves to loopback', async () => {
    expect(await causeCode(`http://localhost:${port()}/`)).toBe(SSRF_BLOCKED_CODE);
  });
});

describe('a name that REBINDS between the check and the connect', () => {
  it('first answer public, second answer the metadata server → the second is refused', async () => {
    const answers = ['93.184.216.34', '169.254.169.254'];
    const rebinding = (_h: string, _o: Record<string, unknown>, cb: (e: null, a: Array<{ address: string; family: number }>) => void) =>
      cb(null, [{ address: answers.shift()!, family: 4 }]);
    const lookup = publicOnlyLookup(rebinding as never);
    const run = () => new Promise<{ err: { code?: string } | null; addr?: unknown }>((resolve) =>
      lookup('rebind.example', {}, (err, addr) => resolve({ err: err as never, addr })));
    expect((await run()).addr).toBe('93.184.216.34');        // the check's answer
    expect((await run()).err?.code).toBe(SSRF_BLOCKED_CODE); // the connect's answer — refused
  });

  it('one private record among public ones is enough to refuse', async () => {
    const mixed = (_h: string, _o: Record<string, unknown>, cb: (e: null, a: Array<{ address: string; family: number }>) => void) =>
      cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]);
    const err = await new Promise<{ code?: string } | null>((resolve) => publicOnlyLookup(mixed as never)('x', { all: true }, (e) => resolve(e as never)));
    expect(err?.code).toBe(SSRF_BLOCKED_CODE);
  });
});

describe('census: every fetch of a user-supplied address goes through the dispatcher', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(n) && !/\.test\./.test(n)) files.push(p); } };
  walk('src/server');
  it('a file that vets a URL with assertPublicHttpUrl fetches it only with publicOnlyInit', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (!/assertPublicHttpUrl/.test(src) || f.endsWith(join('lib', 'ssrfGuard.ts'))) continue;
      const lines = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l) && /(?<![\w.])fetch\(/.test(l));
      for (const l of lines) if (!/publicOnlyInit\(/.test(l)) offenders.push(`${f}: ${l.trim()}`);
    }
    expect(offenders).toEqual([]);
  });
});
