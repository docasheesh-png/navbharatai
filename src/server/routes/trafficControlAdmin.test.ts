/**
 * Traffic Manager V2, P2: the admin route. Owner requirement 6: MFA, authorization and a mandatory reason for every
 * change. Login MFA is optional in this codebase, so the route asks for a fresh authenticator code itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from '../../../tests/helpers/routeTestUtils';
import { MemoryFirestore } from '../../../tests/helpers/memoryFirestore';

const db = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../lib/serverDb', () => ({ getServerDb: () => db.current }));
vi.mock('../lib/audit', () => ({ audit: vi.fn() }));
vi.mock('../lib/adminAuth', () => ({ adminUsername: () => 'owner' }));

import { registerTrafficControlAdminRoutes, __resetTrafficControlAdminForTests, type StepUpResult } from './trafficControlAdmin';
import { __resetTrafficControlSyncForTests, currentTrafficControl } from '../AI/TrafficRegistry/controlSync';

let verdict: StepUpResult = 'ok';
const routes = () => captureRoutes(registerTrafficControlAdminRoutes, (_q: unknown, _s: unknown, n: () => void) => n(), async () => verdict);
async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = mockRes();
  await routes().get(`${method} ${path}`)!(mockReq({ body }), res);
  return res;
}
const off = { global: { gateway: 'off' } };

beforeEach(() => { db.current = new MemoryFirestore(); verdict = 'ok'; __resetTrafficControlAdminForTests(); __resetTrafficControlSyncForTests(); });

describe('every write needs MFA, a reason and the revision the admin saw', () => {
  it('saves with a fresh code and applies on this instance at once', async () => {
    const res = await call('POST', '/api/admin/traffic-control', { expectedRevision: 0, body: off, reason: 'provider outage', totp: '123456' });
    expect(res.statusCode).toBe(200);
    expect(res.body.revision).toBe(1);
    expect(currentTrafficControl()?.global.gateway).toBe('off');
  });
  it.each([
    ['not-enrolled', 403, /Enrol an authenticator/],
    ['invalid', 401, /wrong or expired/],
    ['unavailable', 503, /could not be checked/],
  ] as const)('MFA %s → %i, and nothing is saved', async (v, status, msg) => {
    verdict = v;
    const res = await call('POST', '/api/admin/traffic-control', { expectedRevision: 0, body: off, reason: 'provider outage', totp: '123456' });
    expect(res.statusCode).toBe(status);
    expect(res.body.error).toMatch(msg);
    expect(currentTrafficControl()).toBeNull();
  });
  it('a code is accepted once (replay guard)', async () => {
    expect((await call('POST', '/api/admin/traffic-control', { expectedRevision: 0, body: off, reason: 'first change', totp: '654321' })).statusCode).toBe(200);
    const again = await call('POST', '/api/admin/traffic-control', { expectedRevision: 1, body: { surfaces: { chat: 'legacy' } }, reason: 'second change', totp: '654321' });
    expect(again.statusCode).toBe(401);
    expect(again.body.error).toMatch(/already used/);
  });
  it('a missing code, a missing reason, extra fields and a stale revision are refused', async () => {
    expect((await call('POST', '/api/admin/traffic-control', { expectedRevision: 0, body: off, reason: 'provider outage' })).statusCode).toBe(400);
    expect((await call('POST', '/api/admin/traffic-control', { expectedRevision: 0, body: off, reason: 'x', totp: '111111' })).statusCode).toBe(400);
    expect((await call('POST', '/api/admin/traffic-control', { expectedRevision: 0, body: off, reason: 'provider outage', totp: '222222', admin: true })).statusCode).toBe(400);
    expect((await call('POST', '/api/admin/traffic-control', { expectedRevision: 5, body: off, reason: 'provider outage', totp: '333333' })).statusCode).toBe(409);
  });
  it('rollback needs MFA too, and lands as a new revision', async () => {
    await call('POST', '/api/admin/traffic-control', { expectedRevision: 0, body: { providers: { glm: { state: 'draining' } } }, reason: 'drain glm', totp: '100001' });
    await call('POST', '/api/admin/traffic-control', { expectedRevision: 1, body: off, reason: 'emergency off', totp: '100002' });
    verdict = 'invalid';
    expect((await call('POST', '/api/admin/traffic-control/rollback', { expectedRevision: 2, targetRevision: 1, reason: 'outage over', totp: '100003' })).statusCode).toBe(401);
    verdict = 'ok';
    const res = await call('POST', '/api/admin/traffic-control/rollback', { expectedRevision: 2, targetRevision: 1, reason: 'outage over', totp: '100004' });
    expect(res.statusCode).toBe(200);
    expect(res.body.current).toMatchObject({ revision: 3, global: { gateway: 'on' } });
  });
});

describe('the read shows the store, this instance, the registry and the history; never a key', () => {
  it('reads with no document saved', async () => {
    const res = await call('GET', '/api/admin/traffic-control');
    expect(res.statusCode).toBe(200);
    expect(res.body.current).toBeNull();
    expect(res.body.providers.length).toBeGreaterThan(20);
    expect(res.body.surfaces).toContain('chat');
    expect(JSON.stringify(res.body)).not.toMatch(/API_KEY|sk-|Bearer/);
  });
  it('a storage failure is an honest 503', async () => {
    (db.current as MemoryFirestore).failReads = true;
    const res = await call('GET', '/api/admin/traffic-control');
    expect(res.statusCode).toBe(503);
  });
});
