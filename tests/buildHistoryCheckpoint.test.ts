import { describe, it, expect, vi } from 'vitest';

/**
 * A Bearer header carries the uid directly, the way every other route test here does it.
 * `OWNER` owns the one workspace `countWorkspaceFiles` admits to; nobody else owns anything.
 */
vi.mock('../src/server/lib/authMiddleware', async (orig) => ({
  ...(await orig<typeof import('../src/server/lib/authMiddleware')>()),
  verifyFirebaseToken: vi.fn(async (req: { headers?: Record<string, string> }) => {
    const h = req.headers?.authorization ?? '';
    return h.startsWith('Bearer ') ? h.slice(7) : null;
  }),
}));

/**
 * 🔒 Q-780: the route now asks whether the caller OWNS a workspace with this session id, and that
 * probe is the whole guard — see `buildHistoryAccess.ts` for why `ownedByVerifiedUid` alone proves
 * nothing. Mocked here so the authorized and refused paths are both reachable without Firestore.
 */
vi.mock('../src/server/AgentV3/WorkspaceFileStore', async (orig) => ({
  ...(await orig<typeof import('../src/server/AgentV3/WorkspaceFileStore')>()),
  countWorkspaceFiles: vi.fn(async (ws: string) => (ws === 'agentv3-owner-s1' ? 3 : 0)),
}));

const { registerBuildRoutes } = await import('../src/server/routes/build');
const { captureRoutes, mockReq, mockRes } = await import('./helpers/routeTestUtils');

// Code Versioning (admin 2026-07-24): a MANUAL named checkpoint is saved to the SAME durable,
// cross-device build-history store the automatic per-build checkpoints use. These tests lock the
// route's validation + that it exists (in VITEST the store no-ops, so a valid body returns ok).
//
// 🔴 EVERY CASE BELOW USED TO RUN WITH NO TOKEN AT ALL, and passed — which is precisely the defect
// Q-780 fixed: this route was writing into anybody's version history for anyone who could name a
// session id, and `App.tsx` mints that id as `pro-${Date.now()}`. The validation assertions are
// unchanged; they simply run as the OWNER now, and the refusals they never made are added below.

/** An authorized request: the owner, with a session id they really have an app for. */
const owned = (body: unknown) => mockReq({
  params: { sessionId: 's1' },
  headers: { authorization: 'Bearer owner' },
  body,
});

const routes = captureRoutes(registerBuildRoutes);
const checkpoint = routes.get('POST /api/build-history/:sessionId/checkpoint')!;
const appsList = routes.get('GET /api/versioning/apps')!;

describe('POST /api/build-history/:sessionId/checkpoint', () => {
  it('is registered', () => {
    expect(typeof checkpoint).toBe('function');
  });

  it('rejects a request with no files map (400)', async () => {
    const res = mockRes();
    await checkpoint(owned({ name: 'x' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty files object (400 — nothing to checkpoint)', async () => {
    const res = mockRes();
    await checkpoint(owned({ files: {} }), res);
    expect(res.statusCode).toBe(400);
  });

  it('accepts a valid files map and reports ok', async () => {
    const res = mockRes();
    await checkpoint(owned({ name: 'before risky change', files: { 'index.html': '<h1>hi</h1>' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('🔒 refuses a caller with no token (401) — this route used to accept anyone', async () => {
    const res = mockRes();
    await checkpoint(mockReq({ params: { sessionId: 's1' }, body: { files: { 'a.ts': 'ok' } } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('🔒 refuses a signed-in stranger who guessed the session id (403)', async () => {
    const res = mockRes();
    await checkpoint(mockReq({
      params: { sessionId: 's1' },
      headers: { authorization: 'Bearer stranger' },
      body: { files: { 'a.ts': 'ok' } },
    }), res);
    expect(res.statusCode).toBe(403);
  });

  it('🔒 authorizes BEFORE it validates the body — an unauthorized caller learns nothing about it', async () => {
    // A 400 would tell a stranger their body was the only problem, i.e. that the session id is real.
    const res = mockRes();
    await checkpoint(mockReq({ params: { sessionId: 's1' }, body: { name: 'no files here' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('ignores non-string file entries but still saves the readable ones', async () => {
    const res = mockRes();
    await checkpoint(owned({ files: { 'a.ts': 'ok', 'b.ts': 123 } }), res);
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/versioning/apps — Time Machine app picker', () => {
  it('is registered', () => {
    expect(typeof appsList).toBe('function');
  });
  it('returns an empty list for an unauthenticated caller (no cross-device apps without a verified user)', async () => {
    const res = mockRes();
    await appsList(mockReq({}), res);
    expect(res.body).toEqual({ apps: [] });
  });
});

describe('server registration', () => {
  it('the checkpoint + apps routes are present in build.ts', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '../src/server/routes/build.ts'), 'utf8');
    expect(src).toContain("app.post('/api/build-history/:sessionId/checkpoint'");
    expect(src).toContain("app.get('/api/versioning/apps'");
  });
});
