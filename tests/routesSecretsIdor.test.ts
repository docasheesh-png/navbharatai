/**
 * Round-7 #3 — IDOR regression: DELETE /api/secrets/:userId/:secretId must refuse to soft-delete a
 * secret that belongs to a DIFFERENT user, even though requireUserMatch already proved
 * caller === :userId. user_secrets is a flat collection, so the target's user_id must be checked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

// A flat user_secrets store keyed by document id, mirroring Firestore.
const DOCS: Record<string, { user_id: string; deleted?: boolean }> = {};
const UPDATES: Array<{ id: string; patch: any }> = [];

// secrets.ts now uses the admin-SDK serverDb shim (getServerDb as getDb) instead of the client SDK.
// The shim keeps client snapshot semantics (exists() is a method), so this mock is unchanged in shape.
vi.mock('../src/server/lib/serverDb', () => ({
  doc: (_db: any, _col: string, id: string) => ({ id }),
  getDoc: async (ref: any) => ({
    exists: () => Object.prototype.hasOwnProperty.call(DOCS, ref.id),
    data: () => DOCS[ref.id],
  }),
  updateDoc: async (ref: any, patch: any) => { UPDATES.push({ id: ref.id, patch }); },
  collection: () => ({}),
  addDoc: async () => ({}),
  getDocs: async () => ({ docs: [] }),
  query: () => ({}),
  where: () => ({}),
  getServerDb: () => ({}), // non-null db so the route proceeds past its handle
}));

async function getDeleteHandler() {
  const { registerSecretsRoutes } = await import('../src/server/routes/secrets');
  const routes = captureRoutes(registerSecretsRoutes);
  return routes.get('DELETE /api/secrets/:userId/:secretId')!;
}

describe('DELETE /api/secrets/:userId/:secretId — cross-user IDOR guard', () => {
  beforeEach(() => {
    for (const k of Object.keys(DOCS)) delete DOCS[k];
    UPDATES.length = 0;
  });

  it("refuses (404) to delete a secret owned by a DIFFERENT user — and performs no write", async () => {
    DOCS['victim_secret'] = { user_id: 'victim_uid' };
    const handler = await getDeleteHandler();
    const req = mockReq({ params: { userId: 'attacker_uid', secretId: 'victim_secret' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(UPDATES).toHaveLength(0); // the victim's secret was NOT soft-deleted
  });

  it('returns 404 for a non-existent secret id (no existence leak, no write)', async () => {
    const handler = await getDeleteHandler();
    const req = mockReq({ params: { userId: 'attacker_uid', secretId: 'ghost' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(UPDATES).toHaveLength(0);
  });

  it('allows the OWNER to soft-delete their own secret', async () => {
    DOCS['my_secret'] = { user_id: 'owner_uid' };
    const handler = await getDeleteHandler();
    const req = mockReq({ params: { userId: 'owner_uid', secretId: 'my_secret' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(UPDATES).toEqual([{ id: 'my_secret', patch: { deleted: true } }]);
  });
});
