/**
 * Build + Pro route handler validation tests — Phase 5.3 (real route logic, no server boot).
 *
 * Tests 400/200 validation-only branches that do NOT touch the AI model or file system.
 */
import { describe, it, expect } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

async function importBuildRoutes() {
  const { registerBuildRoutes } = await import('../src/server/routes/build');
  return registerBuildRoutes;
}

async function importProRoutes() {
  const { registerProRoutes } = await import('../src/server/routes/pro');
  return registerProRoutes;
}

// ── Build routes ──────────────────────────────────────────────────────────────

describe('Build routes — /api/capabilities', () => {
  it('GET /api/capabilities returns version and features array', async () => {
    const register = await importBuildRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('GET /api/capabilities');
    expect(handler).toBeDefined();

    const req = mockReq({});
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.version).toBe(1);
    expect(Array.isArray(res.body?.features)).toBe(true);
  });
});

describe('Build routes — /api/guider/plan', () => {
  it('returns 400 when prompt is missing', async () => {
    const register = await importBuildRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/guider/plan');
    expect(handler).toBeDefined();

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/prompt/i);
  });

  it('returns confirm:false when guider flag is disabled', async () => {
    const origFlag = process.env.PRO_AGENTIC_ENGINE;
    delete process.env.PRO_AGENTIC_ENGINE;
    try {
      const register = await importBuildRoutes();
      const routes = captureRoutes(register);
      const handler = routes.get('POST /api/guider/plan');

      const req = mockReq({ body: { prompt: 'build a todo app' } });
      const res = mockRes();
      await handler!(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body?.confirm).toBe(false);
    } finally {
      if (origFlag !== undefined) process.env.PRO_AGENTIC_ENGINE = origFlag;
      else delete process.env.PRO_AGENTIC_ENGINE;
    }
  });
});

describe('Build routes — /api/guider/grade', () => {
  it('returns grade:null when flag is disabled', async () => {
    const origFlag = process.env.PRO_AGENTIC_ENGINE;
    delete process.env.PRO_AGENTIC_ENGINE;
    try {
      const register = await importBuildRoutes();
      const routes = captureRoutes(register);
      const handler = routes.get('POST /api/guider/grade');
      expect(handler).toBeDefined();

      const req = mockReq({ body: { spec: {}, files: { 'index.html': '<h1>Hi</h1>' } } });
      const res = mockRes();
      await handler!(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body?.grade).toBeNull();
    } finally {
      if (origFlag !== undefined) process.env.PRO_AGENTIC_ENGINE = origFlag;
      else delete process.env.PRO_AGENTIC_ENGINE;
    }
  });

  it('returns grade:null when no files provided', async () => {
    const register = await importBuildRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/guider/grade');

    const req = mockReq({ body: { files: {} } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.grade).toBeNull();
  });
});

describe('Build routes — /api/build', () => {
  it('returns 400 when prompt is missing', async () => {
    const register = await importBuildRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/build');
    expect(handler).toBeDefined();

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/prompt/i);
  });
});

describe('Build routes — cost/history attribution identity (security)', () => {
  it('attributes ONLY to a verified uid, never a client-supplied body userId', async () => {
    const { resolveAttributionUserId } = await import('../src/server/routes/build');
    // A verified Firebase uid is used verbatim.
    expect(resolveAttributionUserId('uid_verified')).toBe('uid_verified');
    // No verified identity → no attribution, REGARDLESS of what a body.userId claimed.
    // (The route derives this arg from verifyFirebaseToken(req), not req.body.userId, so a
    //  spoofed body userId can never reach cost/history recording.)
    expect(resolveAttributionUserId(null)).toBeUndefined();
    expect(resolveAttributionUserId(undefined)).toBeUndefined();
    expect(resolveAttributionUserId('')).toBeUndefined();
  });
});

// ── Pro routes ────────────────────────────────────────────────────────────────

describe('Pro routes — legacy /api/pro-chat + /api/pro-build are RETIRED (Phase 1.1 money-bleed fix)', () => {
  it('POST /api/pro-chat returns 410 Gone WITHOUT touching a model (was: unauthenticated platform-budget spend)', async () => {
    const register = await importProRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/pro-chat');
    expect(handler).toBeDefined();
    const req = mockReq({ body: { message: 'build me something for free on your dime' } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(410);
    expect(res.body?.code).toBe('gone');
  });

  it('POST /api/pro-build returns 410 Gone WITHOUT touching a model', async () => {
    const register = await importProRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/pro-build');
    expect(handler).toBeDefined();
    const req = mockReq({ body: { message: 'free build please' } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(410);
    expect(res.body?.code).toBe('gone');
  });
});

describe('Pro routes — /api/pro/code-review', () => {
  it('returns 400 when files are missing', async () => {
    const register = await importProRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/pro/code-review');
    expect(handler).toBeDefined();

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/files/i);
  });

  it('returns 400 when files object is empty', async () => {
    const register = await importProRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/pro/code-review');

    const req = mockReq({ body: { files: {} } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/files/i);
  });
});

describe('Pro routes — /api/pro/deploy', () => {
  it('returns 400 when provider/token/files are missing', async () => {
    const register = await importProRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/pro/deploy');
    expect(handler).toBeDefined();

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/provider, token, and files/i);
  });

  it('returns 400 for vercel deploy when name is missing', async () => {
    const register = await importProRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/pro/deploy');

    const req = mockReq({ body: { provider: 'vercel', token: 'tok', files: { 'index.html': '<h1>' } } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/name required/i);
  });

  it('returns 400 for netlify deploy when siteId is missing', async () => {
    const register = await importProRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/pro/deploy');

    const req = mockReq({ body: { provider: 'netlify', token: 'tok', files: { 'index.html': '<h1>' } } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/siteId required/i);
  });

  it('returns 400 for cloudflare deploy when accountId or name is missing', async () => {
    const register = await importProRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/pro/deploy');

    const req = mockReq({ body: { provider: 'cloudflare', token: 'tok', files: { 'index.html': '<h1>' } } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/accountId and name/i);
  });

  it('returns 400 for unknown provider', async () => {
    const register = await importProRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/pro/deploy');

    const req = mockReq({ body: { provider: 'heroku', token: 'tok', files: { 'index.html': '<h1>' } } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/unknown provider/i);
  });
});
