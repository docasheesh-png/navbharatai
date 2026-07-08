/**
 * Engineer route handler tests — validation paths only.
 *
 * Uses captureRoutes() to invoke real handler functions directly.
 * Only tests the 400/503 validation branches that return before
 * touching the AI router or sandbox actuator.
 */
import { describe, it, expect } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

async function importEngineerRoutes() {
  const { registerEngineerRoutes } = await import('../src/server/routes/engineer');
  return registerEngineerRoutes;
}

describe('Engineer routes — engineer-chat validation', () => {
  it('returns 503 in production without a sandbox configured', async () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origE2b = process.env.E2B_API_KEY;
    const origDocker = process.env.DOCKER_ENABLED;
    process.env.NODE_ENV = 'production';
    delete process.env.E2B_API_KEY;
    delete process.env.DOCKER_ENABLED;
    try {
      const register = await importEngineerRoutes();
      const routes = captureRoutes(register);
      const handler = routes.get('POST /api/engineer-chat');
      expect(handler).toBeDefined();

      const req = mockReq({ body: { workspaceId: 'ws1', instruction: 'build a todo app' } });
      const res = mockRes();
      await handler!(req, res);
      expect(res.statusCode).toBe(503);
      expect(res.body?.error).toMatch(/sandbox/i);
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      if (origE2b !== undefined) process.env.E2B_API_KEY = origE2b;
      else delete process.env.E2B_API_KEY;
      if (origDocker !== undefined) process.env.DOCKER_ENABLED = origDocker;
      else delete process.env.DOCKER_ENABLED;
    }
  });

  it('returns 400 when workspaceId is missing', async () => {
    const register = await importEngineerRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/engineer-chat');

    const req = mockReq({ body: { instruction: 'build something' } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/workspaceId/i);
  });

  it('returns 400 when instruction is missing', async () => {
    const register = await importEngineerRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/engineer-chat');

    const req = mockReq({ body: { workspaceId: 'ws1' } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/instruction/i);
  });
});

describe('Engineer routes — engineer-restore validation', () => {
  it('returns 400 when workspaceId or checkpointId is missing', async () => {
    const register = await importEngineerRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/engineer-restore');
    expect(handler).toBeDefined();

    const req = mockReq({ body: { workspaceId: 'ws1' } }); // missing checkpointId
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/workspaceId and checkpointId/i);
  });
});

describe('Engineer routes — engineer-browser-event validation', () => {
  it('returns 400 when workspaceId, x, or y is missing', async () => {
    const register = await importEngineerRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/engineer-browser-event');
    expect(handler).toBeDefined();

    const req = mockReq({ body: { workspaceId: 'ws1', x: 100 } }); // missing y
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/workspaceId, x .* y/i);
  });
});

describe('Engineer routes — engineer-deploy validation', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const register = await importEngineerRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/engineer-deploy');
    expect(handler).toBeDefined();

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/workspaceId/i);
  });
});

describe('Engineer routes — engineer-pause validation', () => {
  it('returns 400 when sandboxId is missing', async () => {
    const register = await importEngineerRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/engineer-pause');
    expect(handler).toBeDefined();

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/sandboxId/i);
  });
});

describe('Engineer routes — engineer-db-scaffold validation', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const register = await importEngineerRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/engineer-db-scaffold');
    expect(handler).toBeDefined();

    const req = mockReq({ body: { dbConfig: { provider: 'supabase' } } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/workspaceId/i);
  });

  it('returns 400 when dbConfig.provider is invalid', async () => {
    const register = await importEngineerRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/engineer-db-scaffold');

    const req = mockReq({ body: { workspaceId: 'ws1', dbConfig: { provider: 'mysql' } } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/dbConfig\.provider/i);
  });
});

describe('Engineer routes — engineer-guider-plan validation', () => {
  it('returns 400 when instruction is missing', async () => {
    const register = await importEngineerRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/engineer-guider-plan');
    expect(handler).toBeDefined();

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/instruction/i);
  });

  // SECURITY Phase 1.2 — the model-spending branch of guider-plan was reachable by any
  // unauthenticated caller via a client-set `agentic:true`. It must now spend NOTHING without a
  // verified identity: an anonymous caller always gets confirm:false, no model touched.
  it('THE EXPLOIT: agentic:true + no verified identity → confirm:false (never spends the model budget)', async () => {
    const register = await importEngineerRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/engineer-guider-plan');
    // No x-test-verified-uid header → verifiedIdentity() resolves null even though agentic:true.
    const req = mockReq({ body: { instruction: 'build a complete banking app with auth and payments', agentic: true } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.confirm).toBe(false); // gated before any router.route() call
  });
});
