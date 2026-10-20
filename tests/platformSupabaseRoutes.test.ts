import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
const f = vi.hoisted(() => ({
  activeShared: [] as { ref: string; proof: string }[], activeDedicated: [] as { ref: string; proof: string }[],
  admission: vi.fn(), count: vi.fn(), create: vi.fn(), release: vi.fn(), note: vi.fn(), save: vi.fn(), charge: vi.fn(),
}));
vi.mock('../src/server/lib/authMiddleware', () => ({ verifyFirebaseIdentity: async () => ({ uid: 'owner', email: 'owner@example.invalid' }) }));
vi.mock('../src/server/lib/appLockEnforce', () => ({ appLockBlocks: async () => null }));
vi.mock('../src/server/lib/workspaceIdentity', () => ({ ownedByVerifiedUid: (uid: string, ws: string) => uid === 'owner' && ws === 'agentv3-owner-app' }));
vi.mock('../src/server/AgentV3/featureFlag', () => ({ identityGrantEmail: () => 'owner@example.invalid' }));
vi.mock('../src/server/AgentV3/hostApp', () => ({ hostingAvailability: () => ({ available: false }) }));
vi.mock('../src/server/lib/hostingPlan', () => ({ hostingPlansEnabled: () => true, probeHostingPlan: async () => ({ known: true, active: false }) }));
vi.mock('../src/server/lib/HostingQuota', () => ({ readHostingTierForQuota: async () => null }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => ({}), doc: () => ({}), getDoc: async () => ({ exists: () => true, data: () => ({ hostingAddons: [] }) }) }));
vi.mock('../src/server/AgentV3/WorkspaceFileStore', () => ({ loadWorkspaceFiles: vi.fn(), mergeWorkspaceFiles: vi.fn() }));
vi.mock('../src/server/lib/hostingAddonLedger', () => ({
  previewDeliveredCharge: async (_db: unknown, _uid: string, kind: string) => ({ active: kind === 'shared_db' ? f.activeShared : f.activeDedicated, canPay: true }),
  chargeDeliveredHostingAddon: (...args: unknown[]) => f.charge(...args), readHostingAddons: async () => ({ active: [] }),
  removeHostingAddon: vi.fn(), setResellAutoRenew: vi.fn(),
}));
vi.mock('../src/server/lib/platformSupabaseAdmission', async (original) => ({
  ...await original<typeof import('../src/server/lib/platformSupabaseAdmission')>(),
  acquirePlatformAdmission: (...args: unknown[]) => f.admission(...args), organizationProjectCount: (...args: unknown[]) => f.count(...args),
}));
vi.mock('../src/server/lib/platformDatabase', async (original) => ({
  ...await original<typeof import('../src/server/lib/platformDatabase')>(), createPlatformDatabase: (...args: unknown[]) => f.create(...args),
}));
vi.mock('../src/server/lib/supabaseProvisionFlow', () => ({ saveUserSecrets: (...args: unknown[]) => f.save(...args) }));
import { registerResellHostingRoutes } from '../src/server/routes/resellHosting';
let server: Server;
let origin: string;
beforeEach(async () => {
  vi.stubEnv('NAVBHARAT_SUPABASE_DEFAULT', 'on'); vi.stubEnv('NAVBHARAT_SUPABASE_TOKEN', 'fixture');
  vi.stubEnv('NAVBHARAT_SUPABASE_ORG', 'hkfoligpzrmcasgtzeoe');
  vi.stubEnv('NAVBHARAT_SUPABASE_PRODUCTION_APPROVED', 'on'); vi.stubEnv('NAVBHARAT_SUPABASE_MAX_PROJECTS', '2');
  f.activeShared = []; f.activeDedicated = [];
  vi.clearAllMocks();
  f.admission.mockResolvedValue({ release: f.release, noteProject: f.note }); f.release.mockResolvedValue(undefined); f.note.mockResolvedValue(undefined);
  f.count.mockResolvedValue(1);
  f.create.mockResolvedValue({ ok: true, projectRef: 'abcdefghijklmnop', url: 'https://fixture.supabase.co', env: { DATABASE_URL: 'secret-fixture' } });
  f.save.mockResolvedValue(true);
  f.charge.mockResolvedValue({ ok: true, charged: true, addon: { expiresAt: new Date(Date.now() + 86400000).toISOString() } });
  const app = express(); app.use(express.json());
  registerResellHostingRoutes(app, { publishServer: vi.fn(), liveServerWorkspaces: async () => [], teardownServer: vi.fn() });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { vi.unstubAllEnvs(); await new Promise<void>((resolve) => server.close(() => resolve())); });
const post = (path: string, extra = {}) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: 'agentv3-owner-app', agreedToTerms: true, ...extra }) });
const dedicated = '/api/agentv3/resell/database/dedicated';
describe('default organization HTTP flow', () => {
  it('shows the dedicated product, terms and endpoint without a duplicate offer', async () => {
    const data = await (await fetch(origin + '/api/agentv3/resell/options?workspaceId=agentv3-owner-app')).json();
    expect(data.database.purchasePath).toBe(dedicated); expect(data.database.priceInr).toBe(1499);
    expect(data.database.terms.join(' ')).toContain('1499'); expect(data.dedicated).toBeUndefined();
  });
  it('preserves the current app shared controls even if another app uses the same product', async () => {
    f.activeShared = [{ ref: 'paidshared01', proof: 'db:agentv3-owner-app:abcdefghijklmno' }];
    const data = await (await fetch(origin + '/api/agentv3/resell/options?workspaceId=agentv3-owner-app')).json();
    expect(data.database.stopRef).toBe('paidshared01'); expect(data.database.purchasePath).toBe('/api/agentv3/resell/database');
    f.activeShared = [{ ref: 'otherapp01', proof: 'db:agentv3-owner-other:abcdefghijklmno' }];
    const other = await (await fetch(origin + '/api/agentv3/resell/options?workspaceId=agentv3-owner-app')).json();
    expect(other.database.purchasePath).toBe(dedicated);
  });
  it('refuses stale shared-price purchases and ownership violations before cloud work', async () => {
    expect((await post('/api/agentv3/resell/database')).status).toBe(409);
    expect((await post(dedicated, { workspaceId: 'agentv3-other-app' })).status).toBe(403);
    expect(f.create).not.toHaveBeenCalled(); expect(f.admission).not.toHaveBeenCalled();
  });
  it('blocks an unapproved production activation before acquisition or billing', async () => {
    vi.stubEnv('NAVBHARAT_SUPABASE_PRODUCTION_APPROVED', 'off');
    expect((await post(dedicated)).status).toBe(503);
    expect(f.admission).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled(); expect(f.charge).not.toHaveBeenCalled();
  });
  it('checks the selected organization capacity while admitted and charges only after ready', async () => {
    const response = await post(dedicated); const body = await response.json();
    expect(response.status).toBe(200); expect(body.ok).toBe(true); expect(body.env).toBeUndefined();
    expect(f.count).toHaveBeenCalledWith('fixture', 'hkfoligpzrmcasgtzeoe');
    expect(f.create.mock.invocationCallOrder[0]).toBeGreaterThan(f.count.mock.invocationCallOrder[0]);
    expect(f.charge.mock.invocationCallOrder[0]).toBeGreaterThan(f.create.mock.invocationCallOrder[0]);
    expect(f.save).toHaveBeenCalledWith('owner', { DATABASE_URL: 'secret-fixture' }, 'agentv3-owner-app');
    expect(f.release).toHaveBeenCalledOnce();
  });
  it('creates nothing when at capacity or when a previous operation holds the org', async () => {
    f.count.mockResolvedValue(2); expect((await post(dedicated)).status).toBe(502);
    expect(f.create).not.toHaveBeenCalled(); expect(f.charge).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledOnce();
    f.admission.mockResolvedValue(null); expect((await post(dedicated)).status).toBe(409); expect(f.create).not.toHaveBeenCalled();
  });
  it('retains the durable hold for an ambiguous create and for a lost payment response', async () => {
    f.create.mockResolvedValueOnce({ ok: false, cleaned: false, message: 'Lost provider acknowledgement.' });
    expect((await post(dedicated)).status).toBe(502); expect(f.release).not.toHaveBeenCalled(); expect(f.charge).not.toHaveBeenCalled();
    f.charge.mockRejectedValueOnce(Error('lost debit acknowledgement'));
    const response = await post(dedicated); const body = await response.json();
    expect(body.charged).toBeNull(); expect(body.paymentStatus).toBe('unknown'); expect(f.release).not.toHaveBeenCalled();
  });
});
