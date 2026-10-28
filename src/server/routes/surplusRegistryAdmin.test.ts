import type { Express, Request, Response, RequestHandler } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const mocks = vi.hoisted(() => ({ read: vi.fn(), control: vi.fn(), sync: vi.fn(), approve: vi.fn(), audit: vi.fn(), limiter: vi.fn(), connectionStatus: vi.fn(), connectionTest: vi.fn(), credentialCheck: vi.fn(), pilot: vi.fn() }));
vi.mock('../AI/SurplusRegistry/runtime', () => ({
  readSurplusObservations: mocks.read, controlSurplusModel: mocks.control, refreshSurplusRegistry: mocks.sync,
  approveObservedSurplusModels: mocks.approve, APPROVE_OBSERVED_CONFIRM: 'approve-observed-coding',
}));
vi.mock('../AI/SurplusRegistry/connectionTest', () => ({ getSurplusConnectionTestStatus: mocks.connectionStatus, runSurplusConnectionTest: mocks.connectionTest, runSurplusCredentialCheck: mocks.credentialCheck }));
vi.mock('../AI/SurplusRegistry/pilotStatus', () => ({ readSurplusPilotStatus: mocks.pilot }));
vi.mock('../lib/adminAuth', () => ({ adminUsername: () => 'verified-owner' }));
vi.mock('../lib/audit', () => ({ audit: mocks.audit }));
vi.mock('express-rate-limit', () => ({ default: (options: unknown) => { mocks.limiter(options); return (_req: unknown, _res: unknown, next: () => void) => next(); } }));
import { registerSurplusRegistryAdminRoutes } from './surplusRegistryAdmin';
const version = '11111111-1111-4111-8111-111111111111';
const body = { modelId: 'glm-5.3', action: 'disable', expectedRevision: 7, snapshotVersion: version, reason: 'Investigating provider reliability' };
function setup() {
  const routes = new Map<string, RequestHandler[]>();
  const auth: RequestHandler = vi.fn((req, res, next) => {
    if (req.headers['x-admin-token'] !== 'verified') { res.status(401).json({ error: 'Admin token required.' }); return; }
    next();
  });
  const app = { get: (path: string, ...handlers: RequestHandler[]) => routes.set(`GET ${path}`, handlers), post: (path: string, ...handlers: RequestHandler[]) => routes.set(`POST ${path}`, handlers) } as unknown as Express;
  registerSurplusRegistryAdminRoutes(app, auth);
  const response = { setHeader: vi.fn(), json: vi.fn(), status: vi.fn() }; response.status.mockReturnValue(response);
  const call = async (method: string, path = '', payload: unknown = body, token = 'verified') => {
    const handlers = routes.get(`${method} /api/admin/surplus-registry${path}`)!;
    const req = { body: payload, headers: { 'x-admin-token': token } } as unknown as Request;
    for (const handler of handlers) {
      let proceeded = false;
      await handler(req, response as unknown as Response, () => { proceeded = true; });
      if (!proceeded) break;
    }
  };
  return { auth, routes, response, call };
}
beforeEach(() => { vi.clearAllMocks(); mocks.control.mockResolvedValue(undefined); });
describe('admin-only discounted paid registry', () => {
  it('mounts next to the existing verified-admin registry and keeps auth before rate limits and I/O', () => {
    const { auth, routes } = setup();
    expect(routes.size).toBe(8);
    for (const handlers of routes.values()) { expect(handlers[0]).toBe(auth); expect(handlers).toHaveLength(3); }
    expect(mocks.limiter).toHaveBeenCalledWith(expect.objectContaining({ limit: 30, windowMs: 60_000 }));
    expect(mocks.limiter).toHaveBeenCalledWith(expect.objectContaining({ limit: 6, windowMs: 60_000 }));
    const source = readFileSync('src/server/routes/admin.ts', 'utf8');
    expect(source).toContain('registerSurplusRegistryAdminRoutes(app, verifyAdminToken)');
  });
  it.each([['GET', '/pilot-status'], ['GET', ''], ['POST', '/models/action'], ['POST', '/sync'], ['GET', '/connection-test'], ['POST', '/connection-test'], ['POST', '/credential-check']])('rejects unauthorized %s without reading or mutating state', async (method, path) => {
    const { call, response } = setup(); await call(method, path, body, 'forged-or-expired');
    expect(response.status).toHaveBeenCalledWith(401); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.control).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.pilot).not.toHaveBeenCalled(); expect(mocks.connectionStatus).not.toHaveBeenCalled(); expect(mocks.connectionTest).not.toHaveBeenCalled(); expect(mocks.credentialCheck).not.toHaveBeenCalled();
  });
  it('reads only the server-derived pilot status with no-store', async () => {
    const { call, response } = setup();
    mocks.pilot.mockResolvedValue({ status: 'unknown', canDispatch: false });
    await call('GET', '/pilot-status', { accountId: 'ignored', pilotId: 'ignored' });
    expect(mocks.pilot).toHaveBeenCalledExactlyOnceWith();
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.json).toHaveBeenCalledWith({ status: 'unknown', canDispatch: false });
    expect(mocks.connectionTest).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('returns a no-store read without syncing or granting dispatch', async () => {
    const { call, response } = setup(); mocks.read.mockResolvedValue({ status: 'disabled', canDispatch: false });
    await call('GET'); expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.json).toHaveBeenCalledWith({ status: 'disabled', canDispatch: false }); expect(mocks.control).not.toHaveBeenCalled();
  });
  it('manual sync performs metadata refresh only and never grants dispatch', async () => {
    const { call, response } = setup(); mocks.sync.mockResolvedValue({ status: 'synced', count: 12 });
    await call('POST', '/sync', {});
    expect(mocks.sync).toHaveBeenCalledExactlyOnceWith(); expect(mocks.control).not.toHaveBeenCalled(); expect(mocks.connectionTest).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.json).toHaveBeenCalledWith({ status: 'synced', count: 12 });
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_SURPLUS_METADATA_SYNC', { admin: 'verified-owner', result: 'synced' });
  });
  it.each(['held', 'disabled', 'unavailable', 'invalid_configuration'] as const)('returns safe sync status %s without secrets', async status => {
    const { call, response } = setup(); mocks.sync.mockResolvedValue({ status });
    await call('POST', '/sync', {});
    expect(response.json).toHaveBeenCalledWith({ status });
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_SURPLUS_METADATA_SYNC', { admin: 'verified-owner', result: status });
  });
  it('keeps private backend failures out of responses and audit metadata', async () => {
    const { call, response } = setup(); mocks.read.mockRejectedValue(new Error('private-key-and-database-url'));
    await call('GET'); expect(response.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify([response.json.mock.calls, mocks.audit.mock.calls])).not.toContain('private-key');
  });
  it.each([
    { action: 'approve-quality' }, { action: 'activate' }, { action: 'set-budget' }, { action: 'approve-terms' },
    { expectedRevision: -1 }, { expectedRevision: 1.5 }, { expectedRevision: '7' }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { snapshotVersion: '../private' }, { modelId: 'model/../private' }, { reason: 'short' }, { reason: 'x'.repeat(501) }, { apiKey: 'not-accepted' },
  ])('rejects invalid or expanded control scope %j before runtime', async patch => {
    const { call, response } = setup(); await call('POST', '/models/action', { ...body, ...patch });
    expect(response.status).toHaveBeenCalledWith(400); expect(mocks.control).not.toHaveBeenCalled();
  });
  it.each([null, [], 'bad'])('rejects a non-object body %j', async invalid => {
    const { call, response } = setup(); await call('POST', '/models/action', invalid);
    expect(response.status).toHaveBeenCalledWith(400); expect(mocks.control).not.toHaveBeenCalled();
  });
  it.each(['disable', 'enable'])('records only %s with exact revisions and server admin identity', async action => {
    const { call, response } = setup(); await call('POST', '/models/action', { ...body, action, reason: `  ${body.reason}  ` });
    expect(mocks.control).toHaveBeenCalledExactlyOnceWith(body.modelId, action, 7, version, body.reason);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.json).toHaveBeenCalledWith({ ok: true, canDispatch: false });
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_SURPLUS_MODEL_CONTROL', { ...body, action, admin: 'verified-owner', result: 'ok' });
  });
  it.each([['REGISTRY_VERSION_CHANGED', 409, 'conflict'], ['INVALID_SURPLUS_CONTROL', 400, 'invalid'], ['private-database-failure', 503, 'unconfirmed']])('maps %s honestly without automatic retry', async (code, status, result) => {
    const { call, response } = setup(); mocks.control.mockRejectedValue(new Error(code)); await call('POST', '/models/action');
    expect(response.status).toHaveBeenCalledWith(status); expect(mocks.control).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_SURPLUS_MODEL_CONTROL_FAILED', expect.objectContaining({ result }));
    expect(mocks.audit).not.toHaveBeenCalledWith('ADMIN_SURPLUS_MODEL_CONTROL', expect.anything());
    expect(JSON.stringify(response.json.mock.calls)).not.toContain(code);
  });
});


describe('admin approve-observed coding unlock', () => {
  it('records durable approval with confirm token and never claims canDispatch', async () => {
    const { call, response } = setup();
    mocks.approve.mockResolvedValue({ approvedModels: ['glm-5.3'], offerPairs: 1, qualitySource: 'firestore', expiresAt: 9 });
    await call('POST', '/approve-observed', { confirm: 'approve-observed-coding', reason: 'Owner approved observed Surplus coding offers' });
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith({
      reason: 'Owner approved observed Surplus coding offers',
      confirm: 'approve-observed-coding',
    });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, canDispatch: false, approvedModels: ['glm-5.3'] }));
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_SURPLUS_APPROVE_OBSERVED', expect.objectContaining({ admin: 'verified-owner', result: 'ok' }));
  });
  it.each([
    { confirm: 'wrong', reason: 'Owner approved observed Surplus coding offers' },
    { confirm: 'approve-observed-coding', reason: 'short' },
    { confirm: 'approve-observed-coding', reason: 'x'.repeat(501) },
    { confirm: 'approve-observed-coding', reason: 'Owner approved observed Surplus coding offers', extra: true },
  ])('rejects invalid approve body %j', async patch => {
    const { call, response } = setup();
    const body: Record<string, unknown> = { confirm: patch.confirm, reason: patch.reason };
    if ('extra' in patch) body.apiKey = 'not-accepted';
    await call('POST', '/approve-observed', body);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it('maps stale snapshot to 409 without inventing approval', async () => {
    const { call, response } = setup();
    mocks.approve.mockRejectedValue(new Error('STALE_SNAPSHOT'));
    await call('POST', '/approve-observed', { confirm: 'approve-observed-coding', reason: 'Owner approved observed Surplus coding offers' });
    expect(response.status).toHaveBeenCalledWith(409);
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_SURPLUS_APPROVE_OBSERVED_FAILED', expect.objectContaining({ result: 'stale' }));
  });
});

describe('independent admin connection checks', () => {
  const ready = { status: 'ready', environmentConfigured: true, productionFlagsOff: true, latencyMs: null, actualCostUsd: null, expectedResponse: 'not_checked' };
  it('uses cached status while the manager is disabled, without provider calls', async () => {
    const { call, response } = setup(); mocks.connectionStatus.mockResolvedValue(ready);
    await call('GET', '/connection-test');
    expect(mocks.connectionStatus).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.connectionTest).not.toHaveBeenCalled(); expect(mocks.credentialCheck).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(ready); expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
  it.each(['/connection-test', '/credential-check'])('accepts only an empty object at %s', async path => {
    const { call, response } = setup();
    for (const invalid of [null, [], '', 1, { prompt: 'OK' }, { model: 'custom' }, { apiKey: 'secret' }, { budget: 1 }, { hardStopReview: true }, { expectedResponse: 'OK' }, { unexpected: null }]) {
      await call('POST', path, invalid);
      expect(response.status).toHaveBeenLastCalledWith(400);
    }
    expect(mocks.connectionTest).not.toHaveBeenCalled(); expect(mocks.credentialCheck).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('secret');
  });
  it('uses a dedicated low write limit and forwards no request data to the one-shot service', async () => {
    const { call, response } = setup(); mocks.connectionTest.mockResolvedValue(ready);
    await call('POST', '/connection-test', {});
    expect(mocks.limiter).toHaveBeenCalledWith(expect.objectContaining({ limit: 2, windowMs: 60_000 }));
    expect(mocks.connectionTest).toHaveBeenCalledExactlyOnceWith(); expect(response.json).toHaveBeenCalledWith(ready);
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_SURPLUS_CONNECTION_TEST_REQUESTED', { admin: 'verified-owner', result: 'requested' });
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_SURPLUS_CONNECTION_TEST_STATUS', { admin: 'verified-owner', result: 'ready' });
    expect(mocks.control).not.toHaveBeenCalled();
  });
  it.each(['unknown_liability_hold', 'blocked_budget_review', 'passed', 'failed', 'budget_exceeded'])('returns the exact safe %s state without retry or mutation', async status => {
    const { call, response } = setup(); const result = { ...ready, status };
    mocks.connectionTest.mockResolvedValue(result); await call('POST', '/connection-test', {});
    expect(response.json).toHaveBeenCalledWith(result); expect(mocks.connectionTest).toHaveBeenCalledOnce(); expect(mocks.control).not.toHaveBeenCalled();
  });
  it('credential acceptance does not grant or trigger paid testing', async () => {
    const { call, response } = setup(); mocks.credentialCheck.mockResolvedValue({ status: 'accepted' });
    await call('POST', '/credential-check', {});
    expect(mocks.credentialCheck).toHaveBeenCalledExactlyOnceWith(); expect(response.json).toHaveBeenCalledWith({ status: 'accepted' });
    expect(mocks.connectionTest).not.toHaveBeenCalled(); expect(mocks.control).not.toHaveBeenCalled();
  });
  it.each([['GET', '/connection-test', 'connectionStatus'], ['POST', '/connection-test', 'connectionTest'], ['POST', '/credential-check', 'credentialCheck']] as const)('sanitizes failures for %s %s and never retries', async (method, path, mock) => {
    const { call, response } = setup(); mocks[mock].mockRejectedValue(new Error('private-key-account-raw-provider-text'));
    await call(method, path, {});
    expect(response.status).toHaveBeenCalledWith(503); expect(mocks[mock]).toHaveBeenCalledOnce();
    expect(JSON.stringify([response.json.mock.calls, mocks.audit.mock.calls])).not.toContain('private-key');
  });
});
