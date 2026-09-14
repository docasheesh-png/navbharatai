/**
 * PATCH /api/secrets/:userId/:secretId/scope — the route behind "apply this key to all my apps".
 *
 * It changes WHICH APPS receive a saved key. That is not a cosmetic setting: widening a key puts a
 * payment or database secret into the `.env` of apps that never had it, and an attacker who cannot read
 * a vault would be satisfied by spraying one key across every app the victim owns. So it carries the
 * SAME two guards the delete carries — the cross-user IDOR check and a live unlock ticket — and these
 * tests pin both, plus the in-place move that keeps the ciphertext where it is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { mintUnlockTicket, unlockSecret } from '../src/server/lib/vaultTicket';

process.env.VITEST = 'true';

const DOCS: Record<string, { user_id: string; deleted?: boolean; secret_name?: string; workspace_id?: string | null; created_at?: unknown }> = {};
const UPDATES: Array<{ id: string; patch: any }> = [];
const DELETES: string[] = [];

vi.mock('../src/server/lib/serverDb', () => ({
  doc: (_db: any, _col: string, id: string) => ({ id }),
  getDoc: async (ref: any) => ({
    exists: () => Object.prototype.hasOwnProperty.call(DOCS, ref.id),
    data: () => DOCS[ref.id],
  }),
  updateDoc: async (ref: any, patch: any) => { UPDATES.push({ id: ref.id, patch }); },
  deleteDoc: async (ref: any) => { DELETES.push(ref.id); },
  setDoc: async () => {},
  collection: () => ({}),
  addDoc: async () => ({}),
  /**
   * 🔴 THE MOCK HONOURS `where`, AND THAT IS THE POINT OF THIS FILE'S SHARPEST TEST.
   *
   * A mock that returns every document regardless of the query would have made the route look correct
   * while hiding the worst thing it could possibly do: the move retires same-named rows at the
   * destination, so a route that stopped filtering by `secret_name` would DELETE every other shared key
   * the moment somebody ticked "apply to all my apps" on one of them. With the filters ignored, the
   * test proving that cannot fail — it would be testing the mock.
   */
  getDocs: async (q: any) => {
    const clauses: Array<[string, string, unknown]> = Array.isArray(q?.clauses) ? q.clauses : [];
    const docs = Object.entries(DOCS)
      .filter(([, d]) => clauses.every(([field, , value]) => (d as any)[field] === value))
      .map(([id, d]) => ({ id, data: () => d }));
    return { docs };
  },
  query: (_col: any, ...clauses: any[]) => ({ clauses }),
  where: (field: string, op: string, value: unknown) => [field, op, value],
  getServerDb: () => ({}),
}));

async function getScopeHandler() {
  const { registerSecretsRoutes } = await import('../src/server/routes/secrets');
  const routes = captureRoutes(registerSecretsRoutes);
  return routes.get('PATCH /api/secrets/:userId/:secretId/scope')!;
}

const ticketHeaders = (uid: string) => ({ 'x-vault-unlock': mintUnlockTicket(uid, Date.now(), unlockSecret(), 'pin') });

beforeEach(() => {
  for (const k of Object.keys(DOCS)) delete DOCS[k];
  UPDATES.length = 0;
  DELETES.length = 0;
});

describe('the guards', () => {
  it('refuses (404) a secret owned by a DIFFERENT user — and writes nothing', async () => {
    DOCS['victim'] = { user_id: 'victim_uid', secret_name: 'STRIPE_KEY', workspace_id: 'app-1' };
    const res = mockRes();
    await (await getScopeHandler())(
      mockReq({ params: { userId: 'attacker_uid', secretId: 'victim' }, headers: ticketHeaders('attacker_uid'), body: { workspace_id: null } }),
      res,
    );
    expect(res.statusCode).toBe(404);
    expect(UPDATES).toHaveLength(0);
    expect(DELETES).toHaveLength(0);
  });

  it('🔒 refuses the OWNER with NO ticket — and writes nothing', async () => {
    DOCS['mine'] = { user_id: 'owner_uid', secret_name: 'STRIPE_KEY', workspace_id: 'app-1' };
    const res = mockRes();
    await (await getScopeHandler())(
      mockReq({ params: { userId: 'owner_uid', secretId: 'mine' }, body: { workspace_id: null } }),
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(res.body?.needsUnlock).toBe(true);
    expect(UPDATES).toHaveLength(0);
  });

  it('checks OWNERSHIP BEFORE the ticket, so a 401 never reveals that somebody else’s key exists', async () => {
    DOCS['victim'] = { user_id: 'victim_uid', secret_name: 'STRIPE_KEY' };
    const res = mockRes();
    await (await getScopeHandler())(
      mockReq({ params: { userId: 'attacker_uid', secretId: 'victim' }, body: { workspace_id: null } }),
      res,
    );
    expect(res.statusCode).toBe(404); // never 401
  });
});

describe('the move', () => {
  it('shares an app-scoped key: the SAME document changes scope, and nothing is re-encrypted', async () => {
    DOCS['mine'] = { user_id: 'owner_uid', secret_name: 'STRIPE_KEY', workspace_id: 'app-1', created_at: new Date(1) };
    const res = mockRes();
    await (await getScopeHandler())(
      mockReq({ params: { userId: 'owner_uid', secretId: 'mine' }, headers: ticketHeaders('owner_uid'), body: { workspace_id: null } }),
      res,
    );
    expect(res.body).toMatchObject({ success: true, moved: true });
    expect(UPDATES).toHaveLength(1);
    expect(UPDATES[0].id).toBe('mine');
    expect(UPDATES[0].patch.workspace_id).toBeNull();
    // 🔒 The value never moves — that is what makes this safe to do without decrypting anything.
    expect(UPDATES[0].patch).not.toHaveProperty('encrypted_secret_value');
    // "Newest wins" is what every reader uses, so a moved key must win at its destination.
    expect(UPDATES[0].patch.created_at).toBeInstanceOf(Date);
  });

  it('ties a shared key to one app when given an app id', async () => {
    DOCS['mine'] = { user_id: 'owner_uid', secret_name: 'STRIPE_KEY', workspace_id: null };
    const res = mockRes();
    await (await getScopeHandler())(
      mockReq({ params: { userId: 'owner_uid', secretId: 'mine' }, headers: ticketHeaders('owner_uid'), body: { workspace_id: 'app-7' } }),
      res,
    );
    expect(UPDATES[0].patch.workspace_id).toBe('app-7');
  });

  it('THE DUPLICATE: a same-named key already at the destination is removed, not left beside it', async () => {
    DOCS['scoped'] = { user_id: 'owner_uid', secret_name: 'STRIPE_KEY', workspace_id: 'app-1' };
    DOCS['shared'] = { user_id: 'owner_uid', secret_name: 'STRIPE_KEY', workspace_id: null };
    const res = mockRes();
    await (await getScopeHandler())(
      mockReq({ params: { userId: 'owner_uid', secretId: 'scoped' }, headers: ticketHeaders('owner_uid'), body: { workspace_id: null } }),
      res,
    );
    expect(res.body).toMatchObject({ moved: true, duplicatesRetired: 1 });
    expect(DELETES).toEqual(['shared']);
    expect(UPDATES[0].id).toBe('scoped');
  });

  it('a DIFFERENTLY-NAMED key at the destination is never touched', async () => {
    DOCS['scoped'] = { user_id: 'owner_uid', secret_name: 'STRIPE_KEY', workspace_id: 'app-1' };
    DOCS['other'] = { user_id: 'owner_uid', secret_name: 'DATABASE_URL', workspace_id: null };
    const res = mockRes();
    await (await getScopeHandler())(
      mockReq({ params: { userId: 'owner_uid', secretId: 'scoped' }, headers: ticketHeaders('owner_uid'), body: { workspace_id: null } }),
      res,
    );
    // The route filters by secret_name, and the mock above honours that filter — so this genuinely
    // proves DATABASE_URL is untouched rather than proving the mock returns everything.
    expect(DELETES).toEqual([]);
    expect(UPDATES[0].id).toBe('scoped');
  });

  it('already at the destination: answers success with NO write at all', async () => {
    DOCS['mine'] = { user_id: 'owner_uid', secret_name: 'STRIPE_KEY', workspace_id: null };
    const res = mockRes();
    await (await getScopeHandler())(
      mockReq({ params: { userId: 'owner_uid', secretId: 'mine' }, headers: ticketHeaders('owner_uid'), body: { workspace_id: null } }),
      res,
    );
    expect(res.body).toMatchObject({ success: true, moved: false });
    expect(UPDATES).toHaveLength(0);
    expect(DELETES).toHaveLength(0);
  });

  it('an empty or whitespace workspace_id means SHARED, matching every other reader', async () => {
    DOCS['mine'] = { user_id: 'owner_uid', secret_name: 'STRIPE_KEY', workspace_id: 'app-1' };
    const res = mockRes();
    await (await getScopeHandler())(
      mockReq({ params: { userId: 'owner_uid', secretId: 'mine' }, headers: ticketHeaders('owner_uid'), body: { workspace_id: '   ' } }),
      res,
    );
    expect(UPDATES[0].patch.workspace_id).toBeNull();
  });
});
