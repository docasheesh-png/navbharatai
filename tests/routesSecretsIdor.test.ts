/**
 * DELETE /api/secrets/:userId/:secretId — the two things that must both hold.
 *
 * 1. IDOR (Round-7 #3): it must refuse to touch a secret belonging to a DIFFERENT user, even though
 *    requireUserMatch already proved caller === :userId. `user_secrets` is a flat collection, so the
 *    target's own `user_id` has to be checked — the delete keys off :secretId alone.
 *
 * 2. THE VAULT LOCK (2026-09-12): the delete is now REAL (the row and its encrypted value are removed,
 *    not flagged), so it requires a live unlock ticket. An attacker who cannot READ a vault can still be
 *    satisfied by EMPTYING it, which is why destroying a key needs the same proof as revealing one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { mintUnlockTicket, unlockSecret } from '../src/server/lib/deviceUnlock';

process.env.VITEST = 'true';

// A flat user_secrets store keyed by document id, mirroring Firestore.
const DOCS: Record<string, { user_id: string; deleted?: boolean; secret_name?: string }> = {};
const UPDATES: Array<{ id: string; patch: any }> = [];
const DELETES: string[] = [];

// secrets.ts now uses the admin-SDK serverDb shim (getServerDb as getDb) instead of the client SDK.
// The shim keeps client snapshot semantics (exists() is a method), so this mock is unchanged in shape.
vi.mock('../src/server/lib/serverDb', () => ({
  doc: (_db: any, _col: string, id: string) => ({ id }),
  getDoc: async (ref: any) => ({
    exists: () => Object.prototype.hasOwnProperty.call(DOCS, ref.id),
    data: () => DOCS[ref.id],
  }),
  updateDoc: async (ref: any, patch: any) => { UPDATES.push({ id: ref.id, patch }); },
  // The vault's delete is a real document removal now, so the mock has to model it — and the tests below
  // assert on DELETES rather than UPDATES, which is the behaviour change stated in one place.
  deleteDoc: async (ref: any) => { DELETES.push(ref.id); },
  setDoc: async () => { /* device-credential writes are not exercised here */ },
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

/** A genuine ticket for this user, minted the same way the unlock route does. */
function ticketHeaders(uid: string) {
  return { 'x-vault-unlock': mintUnlockTicket(uid, Date.now(), unlockSecret(), 'device-lock') };
}

describe('DELETE /api/secrets/:userId/:secretId — cross-user IDOR guard', () => {
  beforeEach(() => {
    for (const k of Object.keys(DOCS)) delete DOCS[k];
    UPDATES.length = 0;
    DELETES.length = 0;
  });

  it("refuses (404) to delete a secret owned by a DIFFERENT user — and performs no write", async () => {
    DOCS['victim_secret'] = { user_id: 'victim_uid' };
    const handler = await getDeleteHandler();
    const req = mockReq({ params: { userId: 'attacker_uid', secretId: 'victim_secret' }, headers: ticketHeaders('attacker_uid') });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(DELETES).toHaveLength(0); // the victim's secret was NOT removed
    expect(UPDATES).toHaveLength(0);
  });

  it('returns 404 for a non-existent secret id (no existence leak, no write)', async () => {
    const handler = await getDeleteHandler();
    const req = mockReq({ params: { userId: 'attacker_uid', secretId: 'ghost' }, headers: ticketHeaders('attacker_uid') });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(DELETES).toHaveLength(0);
  });

  it('🔒 checks OWNERSHIP BEFORE the ticket, so a 401 never reveals that somebody else\'s key exists', async () => {
    // Order matters for what the two status codes disclose. A non-owner always gets 404 whether or not
    // they hold a ticket, so the endpoint cannot be used to probe for another user's document ids; only
    // the real owner ever sees 401.
    DOCS['victim_secret'] = { user_id: 'victim_uid' };
    const handler = await getDeleteHandler();
    const res = mockRes();
    await handler(mockReq({ params: { userId: 'attacker_uid', secretId: 'victim_secret' } }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE — the vault lock (2026-09-12)', () => {
  beforeEach(() => {
    for (const k of Object.keys(DOCS)) delete DOCS[k];
    UPDATES.length = 0;
    DELETES.length = 0;
  });

  it('🔒 refuses the OWNER with NO ticket — and deletes nothing', async () => {
    DOCS['my_secret'] = { user_id: 'owner_uid', secret_name: 'STRIPE_KEY' };
    const handler = await getDeleteHandler();
    const res = mockRes();
    await handler(mockReq({ params: { userId: 'owner_uid', secretId: 'my_secret' } }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body?.needsUnlock).toBe(true);
    expect(DELETES).toHaveLength(0);
  });

  it('🔒 refuses a FORGED ticket', async () => {
    DOCS['my_secret'] = { user_id: 'owner_uid' };
    const handler = await getDeleteHandler();
    const res = mockRes();
    await handler(mockReq({
      params: { userId: 'owner_uid', secretId: 'my_secret' },
      headers: { 'x-vault-unlock': `device-lock.${Date.now() + 60_000}.deadbeef` },
    }), res);
    expect(res.statusCode).toBe(401);
    expect(DELETES).toHaveLength(0);
  });

  it('🔒 refuses ANOTHER user\'s valid ticket', async () => {
    // A real ticket, correctly signed, but minted for somebody else. The uid is inside the MAC, so it
    // cannot be moved between accounts.
    DOCS['my_secret'] = { user_id: 'owner_uid' };
    const handler = await getDeleteHandler();
    const res = mockRes();
    await handler(mockReq({ params: { userId: 'owner_uid', secretId: 'my_secret' }, headers: ticketHeaders('someone_else') }), res);
    expect(res.statusCode).toBe(401);
    expect(DELETES).toHaveLength(0);
  });

  it('lets the owner WITH a ticket delete the row for good — a real delete, not a flag', async () => {
    // The behaviour the admin asked for: "puri row (keys and value dono) delete ho jaye". A tombstone
    // would leave the encrypted value in the database forever while the screen claimed it was deleted.
    DOCS['my_secret'] = { user_id: 'owner_uid', secret_name: 'OPENAI_API_KEY' };
    const handler = await getDeleteHandler();
    const res = mockRes();
    await handler(mockReq({ params: { userId: 'owner_uid', secretId: 'my_secret' }, headers: ticketHeaders('owner_uid') }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(DELETES).toEqual(['my_secret']);
    // And specifically NOT the old soft delete.
    expect(UPDATES).toHaveLength(0);
  });

  it('accepts the ticket in the BODY as well as the header', async () => {
    DOCS['my_secret'] = { user_id: 'owner_uid' };
    const handler = await getDeleteHandler();
    const res = mockRes();
    await handler(mockReq({
      params: { userId: 'owner_uid', secretId: 'my_secret' },
      body: { ticket: mintUnlockTicket('owner_uid', Date.now(), unlockSecret(), 'account-reauth') },
    }), res);
    expect(res.statusCode).toBe(200);
    expect(DELETES).toEqual(['my_secret']);
  });
});
