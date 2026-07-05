/**
 * Round-8 #2 — /api/domains/connect must require an authenticated owner. Previously it was guarded
 * only by a rate limiter and trusted a spoofable req.body.userId, so an anonymous caller could
 * provision a Cloudflare custom hostname on NavBharatAI's zone (cost/quota abuse) and write a
 * custom_domains mapping under any uid. The auth guard must run BEFORE any provisioning.
 */
import { describe, it, expect, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

const createCustomHostname = vi.fn(async () => ({ id: 'ch_1', status: 'pending' }));
const setDocMock = vi.fn(async () => ({}));

// If the guard were bypassed the route would call these — they must stay untouched.
vi.mock('../src/server/lib/cloudflare', () => ({
  cloudflareConfigured: () => true,
  createCustomHostname,
  getCustomHostname: async () => null,
  fallbackOrigin: () => 'https://fallback.example',
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: any, _c: string, id: string) => ({ id }),
  setDoc: setDocMock,
}));
vi.mock('../src/server/lib/db', () => ({ getDb: () => ({}) }));

async function getConnectHandler() {
  const { registerDomainsRoutes } = await import('../src/server/routes/domains');
  const routes = captureRoutes(registerDomainsRoutes);
  return routes.get('POST /api/domains/connect')!;
}

describe('POST /api/domains/connect — requires authentication', () => {
  it('rejects an unauthenticated request with 401 and provisions NOTHING', async () => {
    // No Authorization header → verifyFirebaseToken resolves null (also VITEST-skipped admin path).
    const handler = await getConnectHandler();
    const req = mockReq({ body: { domain: 'myshop.com', userId: 'attacker_spoofed_uid' }, headers: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(createCustomHostname).not.toHaveBeenCalled(); // no Cloudflare provisioning
    expect(setDocMock).not.toHaveBeenCalled();           // no custom_domains write under a spoofed uid
  });
});
