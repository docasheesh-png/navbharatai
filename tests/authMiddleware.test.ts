/**
 * Tests for authMiddleware — VITEST-skip behavior and token absence handling.
 * Firebase auth is skipped in the test environment so these verify the
 * no-auth fast-paths and basic input validation.
 */
import { describe, it, expect } from 'vitest';
import { verifyFirebaseToken, requireUserMatch, buildRateLimiter, workspaceRateLimiter, rateLimiter } from '../src/server/lib/authMiddleware';
import type { Request, Response, NextFunction } from 'express';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    params: {},
    ip: '127.0.0.1',
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { status: (n: number) => any; json: (v: any) => any; _status?: number; _body?: any } {
  const res: any = {};
  res.status = (n: number) => { res._status = n; return res; };
  res.json = (v: any) => { res._body = v; return res; };
  return res;
}

// ── verifyFirebaseToken ───────────────────────────────────────────────────────

describe('verifyFirebaseToken', () => {
  it('returns null when no Authorization header is present', async () => {
    const req = makeReq({ headers: {} });
    const uid = await verifyFirebaseToken(req);
    expect(uid).toBeNull();
  });

  it('returns null when Authorization header is not Bearer', async () => {
    const req = makeReq({ headers: { authorization: 'Basic abc123' } });
    const uid = await verifyFirebaseToken(req);
    expect(uid).toBeNull();
  });

  it('returns null in VITEST environment (Firebase auth skipped)', async () => {
    const req = makeReq({ headers: { authorization: 'Bearer fake-token' } });
    const uid = await verifyFirebaseToken(req);
    // Firebase admin is null in VITEST → returns null regardless of token
    expect(uid).toBeNull();
  });
});

// ── requireUserMatch ──────────────────────────────────────────────────────────

describe('requireUserMatch (VITEST-skip: always calls next)', () => {
  it('calls next() immediately in VITEST mode', async () => {
    const req = makeReq();
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    const middleware = requireUserMatch('userId');
    await middleware(req, res as any, next);
    expect(nextCalled).toBe(true);
  });

  it('does not set any response status in VITEST mode', async () => {
    const req = makeReq();
    const res = makeRes();
    const middleware = requireUserMatch();
    await middleware(req, res as any, () => {});
    expect(res._status).toBeUndefined();
  });
});

// ── buildRateLimiter ─────────────────────────────────────────────────────────

describe('buildRateLimiter (VITEST-skip: always calls next)', () => {
  it('calls next() immediately in VITEST mode', async () => {
    const req = makeReq();
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    const middleware = buildRateLimiter();
    await middleware(req, res as any, next);
    expect(nextCalled).toBe(true);
  });

  it('does not return a 429 in VITEST mode', async () => {
    const req = makeReq();
    const res = makeRes();
    const middleware = buildRateLimiter();
    // Call many times — rate limiter is VITEST-skipped so never 429
    for (let i = 0; i < 20; i++) {
      await middleware(req, res as any, () => {});
    }
    expect(res._status).toBeUndefined();
  });
});

// ── workspaceRateLimiter + generic rateLimiter (R1 §1.2) ──────────────────────

describe('workspaceRateLimiter (VITEST-skip: always calls next)', () => {
  it('calls next() immediately and never 429s in VITEST mode', async () => {
    const req = makeReq();
    const res = makeRes();
    let nextCount = 0;
    const middleware = workspaceRateLimiter();
    for (let i = 0; i < 80; i++) {
      await middleware(req, res as any, () => { nextCount++; });
    }
    expect(nextCount).toBe(80);
    expect(res._status).toBeUndefined();
  });
});

describe('rateLimiter (generic factory)', () => {
  it('builds a usable middleware that passes through in VITEST', async () => {
    const req = makeReq();
    const res = makeRes();
    let nextCalled = false;
    const middleware = rateLimiter({ name: 'unit-test', authed: 3, anon: 2, noun: 'requests' });
    await middleware(req, res as any, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res._status).toBeUndefined();
  });
});
