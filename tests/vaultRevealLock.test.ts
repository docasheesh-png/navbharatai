/**
 * POST /api/secrets/:userId/reveal — the ONLY route in the app that returns a decrypted key.
 *
 * Which makes it the one worth testing hardest. Every case below is a way the lock could be bypassed or
 * could mislead, and the last two are about the lock's blast radius: the OLD list route must still
 * return names only, so adding the reveal path did not quietly make the safe route unsafe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { mintUnlockTicket, unlockSecret, TICKET_TTL_MS } from '../src/server/lib/deviceUnlock';
import { encrypt } from '../src/server/lib/secrets';

process.env.VITEST = 'true';

interface Row { user_id: string; secret_name?: string; encrypted_secret_value?: string; deleted?: boolean; workspace_id?: string | null }
const DOCS: Record<string, Row> = {};
const ADDED: Array<Record<string, unknown>> = [];

vi.mock('../src/server/lib/serverDb', () => ({
  doc: (_db: any, _col: string, id: string) => ({ id }),
  getDoc: async (ref: any) => ({
    exists: () => Object.prototype.hasOwnProperty.call(DOCS, ref.id),
    data: () => DOCS[ref.id],
  }),
  updateDoc: async () => { /* not exercised here */ },
  deleteDoc: async () => { /* not exercised here */ },
  setDoc: async () => { /* not exercised here */ },
  collection: (_db: any, name: string) => ({ name }),
  // The audit write goes through addDoc; captured so a test can assert the reveal is RECORDED.
  addDoc: async (coll: any, data: any) => { ADDED.push({ collection: coll?.name, ...data }); return { id: 'audit' }; },
  getDocs: async () => ({
    docs: Object.entries(DOCS).map(([id, data]) => ({ id, data: () => data })),
  }),
  query: () => ({}),
  where: () => ({}),
  getServerDb: () => ({}),
}));

async function revealHandler() {
  const { registerSecretsRoutes } = await import('../src/server/routes/secrets');
  return captureRoutes(registerSecretsRoutes).get('POST /api/secrets/:userId/reveal')!;
}
async function listHandler() {
  const { registerSecretsRoutes } = await import('../src/server/routes/secrets');
  return captureRoutes(registerSecretsRoutes).get('GET /api/secrets/:userId')!;
}

const UID = 'owner_uid';
const goodTicket = (uid = UID) => ({ 'x-vault-unlock': mintUnlockTicket(uid, Date.now(), unlockSecret(), 'device-lock') });

beforeEach(() => {
  for (const k of Object.keys(DOCS)) delete DOCS[k];
  ADDED.length = 0;
});

describe('the reveal route refuses without real proof', () => {
  it('🔒 401 with NO ticket — and names nothing about what is stored', async () => {
    DOCS['a'] = { user_id: UID, secret_name: 'STRIPE_SECRET_KEY', encrypted_secret_value: encrypt('sk_live_real') };
    const res = mockRes();
    await (await revealHandler())(mockReq({ params: { userId: UID } }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body?.needsUnlock).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('sk_live_real');
    expect(JSON.stringify(res.body)).not.toContain('STRIPE_SECRET_KEY');
  });

  it('🔒 401 with a FORGED ticket', async () => {
    DOCS['a'] = { user_id: UID, secret_name: 'K', encrypted_secret_value: encrypt('v') };
    const res = mockRes();
    await (await revealHandler())(mockReq({ params: { userId: UID }, headers: { 'x-vault-unlock': `device-lock.${Date.now() + 60_000}.0000` } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('🔒 401 with an EXPIRED ticket — the vault really does re-lock itself', async () => {
    DOCS['a'] = { user_id: UID, secret_name: 'K', encrypted_secret_value: encrypt('v') };
    const stale = mintUnlockTicket(UID, Date.now() - TICKET_TTL_MS - 5_000, unlockSecret(), 'device-lock');
    const res = mockRes();
    await (await revealHandler())(mockReq({ params: { userId: UID }, headers: { 'x-vault-unlock': stale } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('🔒 401 with ANOTHER user\'s genuine ticket', async () => {
    DOCS['a'] = { user_id: UID, secret_name: 'K', encrypted_secret_value: encrypt('v') };
    const res = mockRes();
    await (await revealHandler())(mockReq({ params: { userId: UID }, headers: goodTicket('someone_else') }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('with a live ticket it returns the real values, and tells the truth about them', () => {
  it('decrypts and returns the keys', async () => {
    DOCS['a'] = { user_id: UID, secret_name: 'OPENAI_API_KEY', encrypted_secret_value: encrypt('sk-abc123'), workspace_id: null };
    DOCS['b'] = { user_id: UID, secret_name: 'DATABASE_URL', encrypted_secret_value: encrypt('postgres://x'), workspace_id: 'app-1' };
    const res = mockRes();
    await (await revealHandler())(mockReq({ params: { userId: UID }, headers: goodTicket() }), res);
    expect(res.statusCode).toBe(200);
    const rows = res.body as Array<{ secret_name: string; secret_value: string; readable: boolean; workspace_id: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.secret_name === 'OPENAI_API_KEY')).toMatchObject({ secret_value: 'sk-abc123', readable: true, workspace_id: null });
    expect(rows.find((r) => r.secret_name === 'DATABASE_URL')).toMatchObject({ secret_value: 'postgres://x', readable: true, workspace_id: 'app-1' });
  });

  it('sets Cache-Control: no-store, so a revealed key is never written to a disk cache', async () => {
    DOCS['a'] = { user_id: UID, secret_name: 'K', encrypted_secret_value: encrypt('v') };
    const res = mockRes();
    await (await revealHandler())(mockReq({ params: { userId: UID }, headers: goodTicket() }), res);
    expect(res.get('cache-control')).toContain('no-store');
  });

  it('🔒 reports an UNREADABLE value as unreadable — never as an empty key', async () => {
    // A value encrypted under a rotated key is fine; it just cannot be shown. An empty box would read as
    // "this key is blank" and invite the user to overwrite a credential that is actually working.
    DOCS['a'] = { user_id: UID, secret_name: 'OLD_KEY', encrypted_secret_value: 'g9:notrealciphertext' };
    const res = mockRes();
    await (await revealHandler())(mockReq({ params: { userId: UID }, headers: goodTicket() }), res);
    const row = (res.body as Array<{ secret_name: string; readable: boolean; secret_value: string }>)[0];
    expect(row.secret_name).toBe('OLD_KEY');
    expect(row.readable).toBe(false);
    expect(row.secret_value).toBe('');
  });

  it('skips deleted rows and rows with no name', async () => {
    DOCS['a'] = { user_id: UID, secret_name: 'GONE', encrypted_secret_value: encrypt('v'), deleted: true };
    DOCS['b'] = { user_id: UID, encrypted_secret_value: encrypt('v') };
    DOCS['c'] = { user_id: UID, secret_name: 'KEPT', encrypted_secret_value: encrypt('v') };
    const res = mockRes();
    await (await revealHandler())(mockReq({ params: { userId: UID }, headers: goodTicket() }), res);
    expect((res.body as Array<{ secret_name: string }>).map((r) => r.secret_name)).toEqual(['KEPT']);
  });

  it('RECORDS the reveal, so "who read this key, and when?" has an answer', async () => {
    // A DISTINCTIVE value on purpose: the last assertion checks the secret is absent from the audit row,
    // and a one-letter value like 'v' occurs inside ordinary words ("reveal"), so it would pass whatever
    // the code did. A test that cannot fail is worse than no test.
    DOCS['a'] = { user_id: UID, secret_name: 'K', encrypted_secret_value: encrypt('sk_live_UNIQUE_0fb7') };
    const res = mockRes();
    await (await revealHandler())(mockReq({ params: { userId: UID }, headers: goodTicket() }), res);
    expect(res.statusCode).toBe(200);
    // The audit write is fire-and-forget so it must never block the response; it lands on the next tick.
    await new Promise((r) => setTimeout(r, 0));
    const audit = ADDED.find((a) => a.action === 'reveal');
    expect(audit).toBeTruthy();
    expect(audit).toMatchObject({ collection: 'secret_vault_audit', user_id: UID, key_count: 1, unlock_method: 'device-lock' });
    // 🔒 The log records THAT a key was read, never the key itself.
    expect(JSON.stringify(audit)).not.toContain('sk_live_UNIQUE_0fb7');
  });
});

describe('the OLD list route is unchanged — adding a reveal path made nothing else less safe', () => {
  it('GET still returns names only, with NO value and NO ticket needed', async () => {
    DOCS['a'] = { user_id: UID, secret_name: 'STRIPE_SECRET_KEY', encrypted_secret_value: encrypt('sk_live_dangerous') };
    const res = mockRes();
    await (await listHandler())(mockReq({ params: { userId: UID } }), res);
    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain('STRIPE_SECRET_KEY');
    expect(body).not.toContain('sk_live_dangerous');
    expect(body).not.toContain('encrypted_secret_value');
  });
});
