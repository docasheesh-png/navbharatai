/**
 * T0-9 (enumeration fix) — GET /api/agentv3/conversations must resolve the caller from the VERIFIED
 * Firebase token ONLY, never a claimed ?userId. Before the fix, an unverified caller who knew a victim's
 * uid could pass ?userId=<victim> and enumerate that account's conversation metadata (titles, timestamps,
 * billed amounts). Now an unverified caller gets an empty list — the claimed uid grants nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

// agentv3.ts is a very large module; importing it once (with a generous timeout) keeps each test fast.
let listHandler: any;
beforeAll(async () => {
  const { registerAgentV3Routes } = await import('../src/server/routes/agentv3');
  const routes = captureRoutes(registerAgentV3Routes);
  listHandler = routes.get('GET /api/agentv3/conversations');
}, 30_000);

describe('GET /api/agentv3/conversations — verified-only enumeration (T0-9)', () => {
  it('registers the handler', () => {
    expect(listHandler).toBeDefined();
  });

  it('an UNVERIFIED caller claiming ?userId=<victim> gets an empty list (no cross-user leak)', async () => {
    // No x-test-verified-uid header → verifiedIdentity() resolves to null under VITEST. A claimed
    // query.userId must be ignored entirely.
    const req = mockReq({ query: { userId: 'victim-uid', email: 'victim@x.com' } });
    const res = mockRes();
    await listHandler(req, res);
    expect(res.body).toEqual({ conversations: [] });
  });

  it('a claimed body.userId (no token) is likewise ignored — empty list', async () => {
    const req = mockReq({ body: { userId: 'victim-uid' }, query: {} });
    const res = mockRes();
    await listHandler(req, res);
    expect(res.body).toEqual({ conversations: [] });
  });
});
