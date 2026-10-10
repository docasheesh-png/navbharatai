import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sanitizeProxyRequestHeaders, sanitizeProxyResponseHeaders } from './proxyHeaders';

describe('sanitizeProxyRequestHeaders', () => {
  it('drops credential and identity headers in any letter case and does not mutate the input', () => {
    const original = {
      Authorization: 'Bearer secret',
      Cookie: 'session=1',
      'X-Firebase-AppCheck': 'appcheck-token',
      'X-Test-Verified-Uid': 'uid-1',
      'X-Forwarded-User': 'someone',
      Accept: 'text/html',
      'X-Custom': 'keep',
    };
    const out = sanitizeProxyRequestHeaders(original);
    expect(out).toEqual({ Accept: 'text/html', 'X-Custom': 'keep' });
    expect(original.Authorization).toBe('Bearer secret');
    expect(original.Cookie).toBe('session=1');
  });

  it('drops the lower-case names Node puts on an incoming request, and still keeps host', () => {
    const out = sanitizeProxyRequestHeaders({
      authorization: 'Bearer x',
      cookie: 'a=b',
      'x-firebase-appcheck': 't',
      'x-test-verified-uid': 'u',
      'x-forwarded-user': 'f',
      host: 'preview.navbharatai.com',
      accept: '*/*',
    });
    expect(out).toEqual({ host: 'preview.navbharatai.com', accept: '*/*' });
    expect(out).not.toHaveProperty('authorization');
    expect(out).not.toHaveProperty('cookie');
    expect(out).not.toHaveProperty('x-firebase-appcheck');
    expect(out).not.toHaveProperty('x-test-verified-uid');
    expect(out).not.toHaveProperty('x-forwarded-user');
  });

  it('drops an array-valued cookie and keeps other array-valued headers', () => {
    const out = sanitizeProxyRequestHeaders({ cookie: ['a=1', 'b=2'], accept: ['text/html'] });
    expect(out.cookie).toBeUndefined();
    expect(out.accept).toEqual(['text/html']);
  });

  it('tolerates an empty bag', () => {
    expect(sanitizeProxyRequestHeaders(undefined)).toEqual({});
    expect(sanitizeProxyRequestHeaders(null)).toEqual({});
  });
});

describe('sanitizeProxyResponseHeaders', () => {
  it('drops Set-Cookie in any letter case and does not mutate the input', () => {
    const original = { 'Content-Type': 'text/html', 'Set-Cookie': 'a=b', 'set-cookie': ['c=d', 'e=f'] };
    const out = sanitizeProxyResponseHeaders(original);
    expect(out).toEqual({ 'Content-Type': 'text/html' });
    expect(original['Set-Cookie']).toBe('a=b');
    expect(out).not.toHaveProperty('set-cookie');
    expect(out).not.toHaveProperty('Set-Cookie');
  });
});

describe('the preview proxy and the upgrade handler both use the sanitizers', () => {
  it('HTTP proxy strips request and response headers and still drops host / hop encodings', () => {
    const preview = readFileSync('src/server/routes/preview.ts', 'utf8');
    expect(preview).toContain('sanitizeProxyRequestHeaders(req.headers)');
    expect(preview).toContain('sanitizeProxyResponseHeaders(');
    expect(preview).toContain("k.toLowerCase() !== 'host'");
    expect(preview).toContain("key.toLowerCase() !== 'content-encoding'");
    expect(preview).toContain("key.toLowerCase() !== 'transfer-encoding'");
  });

  it('the upgrade forwards only sanitized headers, times out, and still requires a known session', () => {
    const server = readFileSync('server.ts', 'utf8');
    expect(server).toContain('sanitizeProxyRequestHeaders(req.headers)');
    expect(server).toContain('getPreviewService().serverTarget(m[1])');
    expect(server).toContain('upstream.setTimeout(10_000, () => { upstream.destroy(); clientSocket.destroy(); })');
    expect(server).toContain('if (!target) { clientSocket.destroy(); return; }');
  });
});
