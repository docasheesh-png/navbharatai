import { describe, it, expect, vi } from 'vitest';
import { isAllowedCorsOrigin, setCorsHeaders, corsMiddleware } from './cors';

const fakeRes = () => {
  const headers: Record<string, string> = {};
  let ended = false;
  let statusCode = 0;
  return {
    headers,
    setHeader: (n: string, v: string) => { headers[n] = v; },
    status: (c: number) => { statusCode = c; return { end: () => { ended = true; } }; },
    get ended() { return ended; },
    get statusCode() { return statusCode; },
  };
};

describe('isAllowedCorsOrigin — exact allowlist, never arbitrary reflection', () => {
  it('allows the web origins and BOTH native shell origins (bundled app foundation)', () => {
    expect(isAllowedCorsOrigin('https://navbharatai.web.app', 'production')).toBe(true);
    expect(isAllowedCorsOrigin('https://localhost', 'production')).toBe(true);       // Android/iOS https scheme
    expect(isAllowedCorsOrigin('capacitor://localhost', 'production')).toBe(true);   // default iOS scheme
  });
  it('rejects unknown origins in production — including localhost lookalikes', () => {
    expect(isAllowedCorsOrigin('https://evil.example', 'production')).toBe(false);
    expect(isAllowedCorsOrigin('https://localhost.evil.example', 'production')).toBe(false);
    expect(isAllowedCorsOrigin('http://localhost:5173', 'production')).toBe(false); // dev-only, not prod
    expect(isAllowedCorsOrigin(undefined, 'production')).toBe(false);
  });
  it('non-production additionally allows localhost dev servers (any port), nothing else', () => {
    expect(isAllowedCorsOrigin('http://localhost:5173', 'development')).toBe(true);
    expect(isAllowedCorsOrigin('http://127.0.0.1:3000', undefined)).toBe(true);
    expect(isAllowedCorsOrigin('https://evil.example', undefined)).toBe(false);
  });
});

describe('setCorsHeaders — original per-route helper, shared allowlist', () => {
  it('reflects an allowed origin; ignores a disallowed one', () => {
    const res = fakeRes();
    setCorsHeaders({ headers: { origin: 'https://localhost' } }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://localhost');
    expect(res.headers['Vary']).toBe('Origin');
    const res2 = fakeRes();
    setCorsHeaders({ headers: { origin: 'https://evil.example' } }, res2);
    expect(res2.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

describe('corsMiddleware — global native-shell CORS + preflight', () => {
  const mw = corsMiddleware();

  it('same-origin web traffic (no Origin header) → pure pass-through, no headers', () => {
    const res = fakeRes();
    const next = vi.fn();
    mw({ method: 'GET', headers: {} }, res, next);
    expect(next).toHaveBeenCalled();
    expect(Object.keys(res.headers)).toHaveLength(0);
  });

  it('unknown origin → pass-through with NO reflection (server stays same-origin-only for it)', () => {
    const res = fakeRes();
    const next = vi.fn();
    mw({ method: 'POST', headers: { origin: 'https://evil.example' } }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('native shell request → headers set, next() continues to the route', () => {
    const res = fakeRes();
    const next = vi.fn();
    mw({ method: 'POST', headers: { origin: 'capacitor://localhost' } }, res, next);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('capacitor://localhost');
    expect(next).toHaveBeenCalled();
  });

  it('native shell OPTIONS preflight → 204 short-circuit with methods + reflected request headers', () => {
    const res = fakeRes();
    const next = vi.fn();
    mw(
      { method: 'OPTIONS', headers: { origin: 'https://localhost', 'access-control-request-headers': 'authorization, content-type' } },
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(res.headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(res.headers['Access-Control-Allow-Headers']).toBe('authorization, content-type');
    expect(res.headers['Access-Control-Max-Age']).toBe('86400');
  });

  it('preflight without explicit requested headers falls back to Authorization + Content-Type', () => {
    const res = fakeRes();
    mw({ method: 'OPTIONS', headers: { origin: 'https://localhost' } }, res, vi.fn());
    expect(res.headers['Access-Control-Allow-Headers']).toBe('Authorization, Content-Type');
  });
});
