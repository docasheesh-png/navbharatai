import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ status: vi.fn(), preview: vi.fn(), submit: vi.fn(), audit: vi.fn() }));
vi.mock('../AI/InferenceGateway/adminSetup', () => ({ GatewayAdminSetup: class { status = mocks.status; preview = mocks.preview; submit = mocks.submit; }, GatewaySetupError: class extends Error { constructor(readonly code: string) { super(code); } } }));
vi.mock('../lib/serverDb', () => ({ getServerDb: () => ({}) }));
vi.mock('../lib/adminAuth', () => ({ adminUsername: () => 'verified-admin' }));
vi.mock('../lib/audit', () => ({ audit: mocks.audit }));
vi.mock('express-rate-limit', () => ({ default: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
import { registerInferenceGatewayAdminRoutes } from './inferenceGatewayAdmin';
import { GatewaySetupError } from '../AI/InferenceGateway/adminSetup';
function setup() {
  const routes = new Map<string, any[]>(); const auth = vi.fn((req, res, next) => req.headers?.verified ? next() : res.status(401).json({ error: 'Unauthorized' }));
  const app: any = { get: (path: string, ...handlers: any[]) => routes.set(`GET ${path}`, handlers), post: (path: string, ...handlers: any[]) => routes.set(`POST ${path}`, handlers) };
  registerInferenceGatewayAdminRoutes(app, auth); const res: any = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res);
  return { routes, auth, res, handler: (suffix: string, method = 'POST') => routes.get(`${method} /api/admin/inference-gateway/setup${suffix}`)!.at(-1) };
}
beforeEach(() => vi.clearAllMocks());
describe('gateway setup admin routes', () => {
  it('the shared authenticated admin gate is first and blocks every read/write for unauthenticated callers', () => {
    const f = setup(); expect(f.routes.size).toBe(3);
    for (const handlers of f.routes.values()) { expect(handlers[0]).toBe(f.auth); handlers[0]({ headers: {} }, f.res, vi.fn()); }
    expect(f.res.status).toHaveBeenCalledWith(401); expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('status and preview use no-store; preview does not call mutation or audit', async () => {
    const f = setup(); mocks.status.mockResolvedValue({ reviewState: 'missing' }); mocks.preview.mockResolvedValue({ previewBinding: 'abc' });
    await f.handler('', 'GET')({}, f.res); await f.handler('/preview')({ body: { profileId: 'example' } }, f.res);
    expect(f.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store'); expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('uses the server-derived actor and never logs the submitted object', async () => {
    const f = setup(); mocks.submit.mockResolvedValue({ ok: true, operationId: 'one', catalogRevision: 'one' });
    await f.handler('/review')({ body: { submission: { profileId: 'one' }, previewBinding: 'bound' } }, f.res);
    expect(mocks.submit).toHaveBeenCalledWith({ profileId: 'one' }, 'bound', 'verified-admin');
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_INFERENCE_GATEWAY_REVIEW', { admin: 'verified-admin', result: 'ok', operationId: 'one', catalogRevision: 'one' });
  });
  it.each([null, {}, { submission: {}, previewBinding: 'bound', actor: 'spoof' }, { submission: {}, previewBinding: 'bound', secret: 'never-log' }])('rejects unknown envelope fields before mutation %#', async body => {
    const f = setup(); await f.handler('/review')({ body }, f.res); expect(f.res.status).toHaveBeenCalledWith(400); expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([['invalid-review', 400], ['conflict', 409], ['credential-unavailable', 409], ['preview-changed', 409]])('maps %s without raw input or error disclosure', async (code, status) => {
    const f = setup(); mocks.submit.mockRejectedValue(new GatewaySetupError(code as any));
    await f.handler('/review')({ body: { submission: { private: 'never-log' }, previewBinding: 'bound' } }, f.res);
    expect(f.res.status).toHaveBeenCalledWith(status); expect(JSON.stringify([mocks.audit.mock.calls, f.res.json.mock.calls])).not.toContain('never-log');
  });
  it('uncertain transaction failure is not reported as success or retried', async () => {
    const f = setup(); mocks.submit.mockRejectedValue(new Error('secret upstream connection'));
    await f.handler('/review')({ body: { submission: {}, previewBinding: 'bound' } }, f.res);
    expect(mocks.submit).toHaveBeenCalledOnce(); expect(f.res.status).toHaveBeenCalledWith(503);
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_INFERENCE_GATEWAY_REVIEW_FAILED', { admin: 'verified-admin', result: 'unconfirmed' });
    expect(JSON.stringify([mocks.audit.mock.calls, f.res.json.mock.calls])).not.toContain('secret');
  });
});
