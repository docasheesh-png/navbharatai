import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const fixtures = vi.hoisted(() => ({ run: vi.fn(async (..._args: unknown[]) => ({ status: 200, body: { ok: true } })), db: vi.fn(() => ({})) }));
vi.mock('../src/server/lib/authMiddleware', () => ({ verifyFirebaseToken: async (req: express.Request) => req.get('authorization') === 'Bearer verified-fixture' ? 'verified-user' : null }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: fixtures.db }));
vi.mock('../src/server/lib/sharedDataStore', () => ({ runSharedData: fixtures.run }));
import { registerAppDataRoutes } from '../src/server/routes/appData';

describe('data API separates public app identification from verified user identity', () => {
  it('rejects a copied key and forged uid before database access, then passes only the verified identity', async () => {
    fixtures.run.mockClear(); fixtures.db.mockClear();
    const app = express(); app.use(express.json()); registerAppDataRoutes(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/data/agentv3-fixture/orders`;
    try {
      const denied = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer nb_copied-key' }, body: JSON.stringify({ actorUid: 'owner', uid: 'owner' }) });
      expect(denied.status).toBe(401);
      expect(fixtures.db).not.toHaveBeenCalled(); expect(fixtures.run).not.toHaveBeenCalled();
      const allowed = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer verified-fixture', 'X-Nbai-Key': 'nb_public-app-key' }, body: JSON.stringify({ actorUid: 'forged-owner', item: 'fixture' }) });
      expect(allowed.status).toBe(200);
      expect(fixtures.run.mock.calls[0][2]).toMatchObject({ actorUid: 'verified-user', key: 'nb_public-app-key' });
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
