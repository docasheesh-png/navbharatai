/**
 * Route handler validation tests — audit, githubAuth, sync, cloudsync, and team routes.
 *
 * Tests 400/401 early-return branches that fire before any AI/Firestore calls.
 * No server boot required; uses captureRoutes() + direct handler invocation.
 */
import { describe, it, expect } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

// ── Audit / security-scan routes ──────────────────────────────────────────────

async function importAuditRoutes() {
  const { registerAuditRoutes } = await import('../src/server/routes/audit');
  return registerAuditRoutes;
}

describe('Audit routes — /api/security/scan', () => {
  it('registers security and audit endpoints', async () => {
    const register = await importAuditRoutes();
    const routes = captureRoutes(register);
    expect(routes.has('POST /api/security/scan')).toBe(true);
    expect(routes.has('POST /api/audit/full')).toBe(true);
  });

  it('returns 400 when target is missing', async () => {
    const register = await importAuditRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/security/scan')!;

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/target is required/i);
  });

  it('returns 400 when url is missing for full audit', async () => {
    const register = await importAuditRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/audit/full')!;

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/url is required/i);
  });
});

// ── GitHub auth routes ─────────────────────────────────────────────────────────

async function importGithubAuthRoutes() {
  const { registerGithubAuthRoutes } = await import('../src/server/routes/githubAuth');
  return registerGithubAuthRoutes;
}

describe('GitHub auth routes — /api/github/user', () => {
  it('registers GitHub auth endpoints', async () => {
    const register = await importGithubAuthRoutes();
    const routes = captureRoutes(register);
    expect(routes.has('GET /api/auth/github/url')).toBe(true);
    expect(routes.has('GET /api/github/user')).toBe(true);
    expect(routes.has('GET /api/github/repos')).toBe(true);
  });

  it('returns 401 when Authorization header is missing for /api/github/user', async () => {
    const register = await importGithubAuthRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('GET /api/github/user')!;

    const req = mockReq({ headers: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toMatch(/unauthorized/i);
  });

  it('returns 401 when Authorization header is missing for /api/github/repos', async () => {
    const register = await importGithubAuthRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('GET /api/github/repos')!;

    const req = mockReq({ headers: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toMatch(/unauthorized/i);
  });
});

// ── Sync routes ───────────────────────────────────────────────────────────────

async function importSyncRoutes() {
  const { registerSyncRoutes } = await import('../src/server/routes/sync');
  return registerSyncRoutes;
}

describe('Sync routes — /api/sync/:userId', () => {
  it('returns 400 on POST /api/sync/:userId when userId is missing in body', async () => {
    const register = await importSyncRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/sync/:userId')!;

    // Omit userId from body (it comes from req.params in the route but the handler checks body)
    const req = mockReq({ body: {}, params: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/not authenticated/i);
  });
});

// ── Cloud-sync routes ─────────────────────────────────────────────────────────

async function importCloudsyncRoutes() {
  const { registerCloudsyncRoutes } = await import('../src/server/routes/cloudsync');
  return registerCloudsyncRoutes;
}

describe('Cloudsync routes — /api/cloudsync/github', () => {
  it('registers cloud-sync endpoints', async () => {
    const register = await importCloudsyncRoutes();
    const routes = captureRoutes(register);
    expect(routes.has('POST /api/cloudsync/github')).toBe(true);
  });

  it('returns 401 when GitHub token is missing', async () => {
    const register = await importCloudsyncRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/cloudsync/github')!;

    const req = mockReq({ body: { owner: 'acme', repo: 'test', files: {} } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toMatch(/unauthorized/i);
  });
});

// ── Team routes ───────────────────────────────────────────────────────────────

async function importTeamRoutes() {
  const { registerTeamRoutes } = await import('../src/server/routes/team');
  return registerTeamRoutes;
}

describe('Team routes — /api/team/invite', () => {
  it('registers the team invite endpoint', async () => {
    const register = await importTeamRoutes();
    const routes = captureRoutes(register);
    expect(routes.has('POST /api/team/invite')).toBe(true);
  });

  it('returns 400 when email or userId is missing', async () => {
    const register = await importTeamRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/team/invite')!;

    const req = mockReq({ body: { email: 'test@example.com' } }); // missing userId
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/email and userId required/i);
  });

  it('returns 400 for invalid email address', async () => {
    const register = await importTeamRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/team/invite')!;

    const req = mockReq({ body: { email: 'not-an-email', userId: 'user123' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/invalid email/i);
  });

  it('issues a durable, token-based invite link for a valid request', async () => {
    const register = await importTeamRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/team/invite')!;

    const req = mockReq({ body: { email: 'teammate@example.com', userId: 'owner1', role: 'Editor' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.body?.ok).toBe(true);
    expect(typeof res.body?.token).toBe('string');
    expect(res.body?.token.length).toBeGreaterThan(10);
    expect(res.body?.role).toBe('editor'); // 'Editor' normalised
    expect(res.body?.inviteUrl).toBe(`/?join=${res.body.token}`);
    expect(res.body?.emailSent).toBe(false); // honest: no SMTP infra, link-based
  });
});

describe('Team routes — invite lifecycle', () => {
  it('registers the accept, resolve, members, revoke and role endpoints', async () => {
    const register = await importTeamRoutes();
    const routes = captureRoutes(register);
    expect(routes.has('POST /api/team/accept')).toBe(true);
    expect(routes.has('GET /api/team/invite/:token')).toBe(true);
    expect(routes.has('GET /api/team/:teamId/members')).toBe(true);
    expect(routes.has('POST /api/team/invite/:token/revoke')).toBe(true);
    expect(routes.has('POST /api/team/member/remove')).toBe(true);
    expect(routes.has('POST /api/team/member/role')).toBe(true);
  });

  it('member/role validates inputs and normalises the role', async () => {
    const register = await importTeamRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/team/member/role')!;

    const bad = mockReq({ body: { teamId: 'owner1', uid: 'u2' } }); // missing role
    const badRes = mockRes();
    await handler(bad, badRes);
    expect(badRes.statusCode).toBe(400);
    expect(badRes.body?.error).toMatch(/teamId, uid and role required/i);

    const ok = mockReq({ body: { teamId: 'owner1', uid: 'u2', role: 'Editor' } });
    const okRes = mockRes();
    await handler(ok, okRes);
    expect(okRes.body?.ok).toBe(true);
    expect(okRes.body?.role).toBe('editor'); // 'Editor' normalised
  });

  it('accept requires authentication (401 without a verified token)', async () => {
    const register = await importTeamRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/team/accept')!;

    const req = mockReq({ body: { token: 'sometoken' } }); // no Authorization header
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toMatch(/sign in/i);
  });

  it('resolve returns 404 for an unknown invite token', async () => {
    const register = await importTeamRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('GET /api/team/invite/:token')!;

    const req = mockReq({ params: { token: 'does-not-exist' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body?.valid).toBe(false);
  });

  it('member/remove validates its inputs', async () => {
    const register = await importTeamRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/team/member/remove')!;

    const req = mockReq({ body: { teamId: 'owner1' } }); // missing uid
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/teamId and uid required/i);
  });
});
