/**
 * Tests for authMiddleware — VITEST-skip behavior and token absence handling.
 * Firebase auth is skipped in the test environment so these verify the
 * no-auth fast-paths and basic input validation.
 */
import { describe, it, expect } from 'vitest';
import { verifyFirebaseToken, requireUserMatch, buildRateLimiter, workspaceRateLimiter, inbrowserPreviewRateLimiter, INBROWSER_PREVIEW_RATE, ZIP_CHUNK_RATE, PREVIEW_POLL_RATE, rateLimiter, verifyIdentityWithReason, adminAppOptions, type VerifierAuth } from '../src/server/lib/authMiddleware';
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

describe('inbrowserPreviewRateLimiter — the always-available preview must not hit the tight workspace cap', () => {
  it('builds a usable pass-through middleware (wired, never blocks the core preview in VITEST)', async () => {
    const req = makeReq();
    const res = makeRes();
    let nextCount = 0;
    const middleware = inbrowserPreviewRateLimiter();
    for (let i = 0; i < 50; i++) await middleware(req, res as any, () => { nextCount++; });
    expect(nextCount).toBe(50);
    expect(res._status).toBeUndefined();
  });

  it('has a FAR more generous limit than the old 30/hour anon workspace cap that broke an active builder', () => {
    // Regression guard for the 2026-07-06 report: an active builder hit "max 30 requests per hour" on
    // the in-browser preview because it shared workspaceRateLimiter (anon:30). This dedicated limiter is
    // for a cheap, cached, local render — both tiers must stay well above the general workspace bucket.
    expect(INBROWSER_PREVIEW_RATE.anon).toBeGreaterThanOrEqual(300);
    expect(INBROWSER_PREVIEW_RATE.authed).toBeGreaterThanOrEqual(600);
    expect(INBROWSER_PREVIEW_RATE.anon).toBeGreaterThan(30); // strictly beats the old broken cap
    expect(INBROWSER_PREVIEW_RATE.name).toBe('inbrowser-preview'); // its OWN bucket, not shared with 'workspace'
  });

  it('is IN-MEMORY-ONLY (durable:false) so a preview poll/render never writes to Firestore', () => {
    // Firestore-write-quota fix (2026-07-11): the preview render is hit up to 1200×/hr on every
    // poll/edit, and the durable limiter did a Firestore READ+WRITE per request — the dominant source
    // of daily write-quota exhaustion (payments/wallet-writes then failed once the free-tier cap hit).
    // This no-cost, cached, per-instance-limited endpoint must stay durable:false so writes can't return.
    expect(INBROWSER_PREVIEW_RATE.durable).toBe(false);
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

// ADMIN QUESTION 2026-08-04: "60 preview per hour — per user, or for the WHOLE app?" Answering it from
// the code surfaced a real bug. The limiter key is `${name}:${uid}`, so 60/hr is PER USER (100 users do
// NOT share 60) — but the 'workspace' bucket is shared across ~44 routes, and two high-frequency paths
// were sitting in it:
//   • /api/zip-upload/chunk — an 8 MB chunk per request, so the advertised 5 GB import needs 640 of
//     them. It would 429 at chunk ~60, i.e. after ~470 MB: the 5 GB ceiling was FICTION in production.
//   • preview-health / preview-error — the watchdog re-probes every 150s and on every window focus, so
//     a tab left open all afternoon exhausted the bucket and the health probe started 429-ing. The
//     preview was fine; NavBharatAI reported it as down.
describe('high-frequency endpoints have their OWN buckets (admin scaling question 2026-08-04)', () => {
  const CHUNK_BYTES = 8 * 1024 * 1024;
  const MAX_ARCHIVE = 5 * 1024 * 1024 * 1024;

  it('the chunk limiter fits a FULL 5 GB import, with headroom for retries', () => {
    const chunksFor5GB = Math.ceil(MAX_ARCHIVE / CHUNK_BYTES); // 640
    expect(ZIP_CHUNK_RATE.authed).toBeGreaterThan(chunksFor5GB);
    // The old shared cap could not even carry 500 MB — lock that this never regresses to it.
    expect(ZIP_CHUNK_RATE.authed).toBeGreaterThan(60);
  });

  it('the chunk limiter is its OWN bucket, never shared with general workspace requests', () => {
    expect(ZIP_CHUNK_RATE.name).toBe('zip-chunk');
    expect(ZIP_CHUNK_RATE.name).not.toBe('workspace');
  });

  it('a chunk never writes to Firestore — 640 durable writes per import would protect nothing', () => {
    expect(ZIP_CHUNK_RATE.durable).toBe(false);
  });

  it('anonymous callers cannot upload chunks at all (begin already requires a signed-in user)', () => {
    expect(ZIP_CHUNK_RATE.anon).toBe(0);
  });

  it('preview polling gets its own generous bucket so a long session never fakes a dead preview', () => {
    expect(PREVIEW_POLL_RATE.name).toBe('preview-poll');
    expect(PREVIEW_POLL_RATE.authed).toBeGreaterThanOrEqual(600);
    expect(PREVIEW_POLL_RATE.durable).toBe(false);
    // A 150s watchdog is 24 probes/hr; with focus/visibility re-probes and error reports the old 60
    // shared with everything else was reachable in one afternoon.
    expect(PREVIEW_POLL_RATE.authed).toBeGreaterThan(60);
  });
});
