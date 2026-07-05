/**
 * Tests for authMiddleware — VITEST-skip behavior and token absence handling.
 * Firebase auth is skipped in the test environment so these verify the
 * no-auth fast-paths and basic input validation.
 */
import { describe, it, expect } from 'vitest';
import { verifyFirebaseToken, requireUserMatch, buildRateLimiter, workspaceRateLimiter, rateLimiter, verifyIdentityWithReason, adminAppOptions, type VerifierAuth } from '../src/server/lib/authMiddleware';
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

// ── verifyIdentityWithReason (honest "why is this build anon?" — admin investigation) ────────────

describe('verifyIdentityWithReason', () => {
  const okAuth: VerifierAuth = { async verifyIdToken() { return { uid: 'u1', email: 'a@b.com' }; } };

  it("verifies a real token → identity + reason 'ok'", async () => {
    const r = await verifyIdentityWithReason('Bearer good', async () => okAuth);
    expect(r).toEqual({ identity: { uid: 'u1', email: 'a@b.com' }, reason: 'ok' });
  });

  it("no Bearer token → reason 'no-bearer' (never guesses an identity)", async () => {
    expect((await verifyIdentityWithReason(undefined, async () => okAuth)).reason).toBe('no-bearer');
    expect((await verifyIdentityWithReason('Basic x', async () => okAuth)).reason).toBe('no-bearer');
  });

  it("admin SDK unavailable → reason 'admin-unavailable'", async () => {
    const r = await verifyIdentityWithReason('Bearer good', async () => null);
    expect(r).toEqual({ identity: null, reason: 'admin-unavailable' });
  });

  it("verifyIdToken keeps throwing → reason 'verify-error' with the detail (the systematic cert/network case)", async () => {
    let calls = 0;
    const throwing: VerifierAuth = { async verifyIdToken() { calls++; throw new Error('Failed to fetch public keys'); } };
    const r = await verifyIdentityWithReason('Bearer good', async () => throwing);
    expect(r.reason).toBe('verify-error');
    expect(r.identity).toBeNull();
    expect(r.detail).toMatch(/public keys/i);
    expect(calls).toBe(2); // retried once (cold-start race), then reported
  });

  it('retries ONCE and succeeds on the second attempt (a transient cold-start hiccup)', async () => {
    let calls = 0;
    const flaky: VerifierAuth = { async verifyIdToken() { calls++; if (calls === 1) throw new Error('transient'); return { uid: 'u2', email: null }; } };
    const r = await verifyIdentityWithReason('Bearer good', async () => flaky);
    expect(r).toEqual({ identity: { uid: 'u2', email: null }, reason: 'ok' });
    expect(calls).toBe(2);
  });
});

describe('adminAppOptions (explicit projectId hardening)', () => {
  it('passes an explicit projectId when a project env is set (deterministic verification)', () => {
    expect(adminAppOptions({ FIREBASE_PROJECT_ID: 'proj-a' } as NodeJS.ProcessEnv)).toEqual({ projectId: 'proj-a' });
    expect(adminAppOptions({ GOOGLE_CLOUD_PROJECT: 'proj-b' } as NodeJS.ProcessEnv)).toEqual({ projectId: 'proj-b' });
    expect(adminAppOptions({ GCLOUD_PROJECT: 'proj-c' } as NodeJS.ProcessEnv)).toEqual({ projectId: 'proj-c' });
  });

  it('falls back to {} (today\'s auto-detect) when no project env is set — purely additive', () => {
    expect(adminAppOptions({} as NodeJS.ProcessEnv)).toEqual({});
    expect(adminAppOptions({ FIREBASE_PROJECT_ID: '  ' } as NodeJS.ProcessEnv)).toEqual({});
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
