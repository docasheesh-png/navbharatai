import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ view: vi.fn(), metrics: vi.fn(), limiter: vi.fn(), control: vi.fn(), budget: vi.fn(), audit: vi.fn() }));
vi.mock('../AI/FreeChain/runtime', () => ({ freeChainAdminView: mocks.view, freeChainAdminMetrics: mocks.metrics, controlFreeChain: mocks.control, controlFreeChainBudget: mocks.budget }));
vi.mock('../lib/audit', () => ({ audit: mocks.audit }));
vi.mock('../lib/adminAuth', () => ({ adminUsername: () => 'verified-owner' }));
vi.mock('express-rate-limit', () => ({ default: (options: unknown) => { mocks.limiter(options); return (_req: unknown, _res: unknown, next: () => void) => next(); } }));
import { registerFreeChatChainRoutes } from './freeChatChainAdmin';
const expectedControls = { enabled: true, rolloutPercent: 0, disabledProviders: [] };
const action = { enabled: false, reason: 'Investigating provider errors', expectedControls };
function setup() {
  const routes = new Map<string, any[]>();
  const auth = vi.fn((req, res, next) => { if (req.headers?.['x-admin-token'] === 'verified') next(); else res.status(401).json({ error: 'Unauthorized' }); });
  const app: any = { get: (path: string, ...handlers: any[]) => routes.set(`GET ${path}`, handlers), post: (path: string, ...handlers: any[]) => routes.set(`POST ${path}`, handlers) };
  registerFreeChatChainRoutes(app, auth);
  const response: any = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() }; response.status.mockReturnValue(response);
  return { routes, auth, response, handler: (method: string, path: string) => routes.get(`${method} /api/admin/free-chat-chain${path}`)!.at(-1) };
}
beforeEach(() => vi.clearAllMocks());
describe('Free Chat Chain admin API', () => {
  it('puts the shared admin auth gate first on every route', () => {
    const { routes, auth } = setup(); expect(routes.size).toBe(4);
    for (const handlers of routes.values()) expect(handlers[0]).toBe(auth);
    expect(mocks.view).not.toHaveBeenCalled(); expect(mocks.metrics).not.toHaveBeenCalled(); expect(mocks.control).not.toHaveBeenCalled(); expect(mocks.budget).not.toHaveBeenCalled();
  });
  it('an unauthenticated request stops before any read or mutation', async () => {
    const { routes, response } = setup();
    for (const handlers of routes.values()) {
      let index = 0;
      const next = (): void => { const handler = handlers[index++]; if (handler) handler({ body: action, headers: {} }, response, next); };
      next();
    }
    expect(response.status).toHaveBeenCalledWith(401); expect(mocks.view).not.toHaveBeenCalled(); expect(mocks.metrics).not.toHaveBeenCalled(); expect(mocks.control).not.toHaveBeenCalled(); expect(mocks.budget).not.toHaveBeenCalled();
  });
  it('returns saved status only with no-store caching', async () => {
    const { handler, response } = setup(); mocks.view.mockResolvedValue({ enabled: false });
    await handler('GET', '')({}, response);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store'); expect(response.json).toHaveBeenCalledWith({ enabled: false });
    expect(mocks.control).not.toHaveBeenCalled(); expect(mocks.budget).not.toHaveBeenCalled(); expect(mocks.metrics).not.toHaveBeenCalled();
  });
  it('failed reads are 503, not successful empty metrics or leaked provider details', async () => {
    const { handler, response } = setup(); mocks.view.mockRejectedValue(new Error('secret connection string'));
    await handler('GET', '')({}, response); expect(response.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('secret');
  });
  it('only the explicit metrics route scans history, with no-store and its own conservative limiter', async () => {
    const { handler, response } = setup(); mocks.metrics.mockResolvedValue({ observedAt: 1234, scanLimit: 4096 });
    await handler('GET', '/metrics')({}, response);
    expect(mocks.metrics).toHaveBeenCalledOnce(); expect(mocks.view).not.toHaveBeenCalled(); expect(mocks.control).not.toHaveBeenCalled(); expect(mocks.budget).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({ observedAt: 1234, scanLimit: 4096 });
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(mocks.limiter).toHaveBeenCalledWith(expect.objectContaining({ windowMs: 60_000, limit: 2 }));
  });
  it('a failed explicit scan is unavailable, not an empty successful history snapshot', async () => {
    const { handler, response } = setup(); mocks.metrics.mockRejectedValue(new Error('private store connection'));
    await handler('GET', '/metrics')({}, response);
    expect(response.status).toHaveBeenCalledWith(503); expect(mocks.metrics).toHaveBeenCalledOnce();
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('private');
  });
  it.each([{ ...action, enabled: 'off' }, { ...action, rolloutPercent: 101 }, { ...action, rolloutPercent: -1 }, { ...action, disabledProviders: ['new-provider'] }, { ...action, actor: 'attacker' }, { ...action, apiKey: 'secret' }, { ...action, reason: 'short' }, { ...action, expectedControls: undefined }])('rejects malformed controls before runtime or audit %#', async body => {
    const { handler, response } = setup(); await handler('POST', '/control')({ body }, response);
    expect(response.status).toHaveBeenCalledWith(400); expect(mocks.control).not.toHaveBeenCalled(); expect(mocks.budget).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([{ enabled: false }, { rolloutPercent: 5 }, { disabledProviders: ['groq'] }, { disabledProviders: ['glm47'] }, { disabledProviders: ['glm45'] }])('persists and audits allowed control %# with server-derived actor', async change => {
    const { handler, response } = setup(); const body = { ...change, reason: action.reason, expectedControls }; mocks.control.mockResolvedValue(undefined);
    await handler('POST', '/control')({ body }, response);
    expect(mocks.control).toHaveBeenCalledWith(body, 'verified-owner'); expect(response.json).toHaveBeenCalledWith({ ok: true });
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_FREE_CHAT_CHAIN_CONTROL', { admin: 'verified-owner', controlTarget: 'free-chat-chain', ...body, result: 'ok' });
  });
  it('redacts credentials pasted into the reason before persistence and audit', async () => {
    const { handler, response } = setup(); const secret = 'sk-' + 's'.repeat(40); mocks.control.mockResolvedValue(undefined);
    await handler('POST', '/control')({ body: { ...action, reason: `Investigating key ${secret}` } }, response);
    expect(response.json).toHaveBeenCalledWith({ ok: true });
    expect(JSON.stringify([mocks.control.mock.calls, mocks.audit.mock.calls])).not.toContain(secret);
    expect(mocks.control.mock.calls[0][0].reason).toContain('[REDACTED]');
  });
  it('conflicting settings are rejected and audited without retry', async () => {
    const { handler, response } = setup(); mocks.control.mockRejectedValue(new Error('FREE_CHAIN_CONTROL_CONFLICT'));
    await handler('POST', '/control')({ body: action }, response); expect(response.status).toHaveBeenCalledWith(409); expect(mocks.control).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_FREE_CHAT_CHAIN_CONTROL_FAILED', expect.objectContaining({ result: 'conflict' }));
  });
  it('lost writes are uncertain, sanitized and never audited as success', async () => {
    const { handler, response } = setup(); mocks.control.mockRejectedValue(new Error('secret upstream URL'));
    await handler('POST', '/control')({ body: action }, response); expect(response.status).toHaveBeenCalledWith(503);
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_FREE_CHAT_CHAIN_CONTROL_FAILED', expect.objectContaining({ result: 'unconfirmed' }));
    expect(mocks.audit).not.toHaveBeenCalledWith('ADMIN_FREE_CHAT_CHAIN_CONTROL', expect.anything());
    expect(JSON.stringify([response.json.mock.calls, mocks.audit.mock.calls])).not.toContain('secret');
  });
});


describe('audited shared paid-budget endpoint', () => {
  const budget = { capUsd: 0, expectedRevision: 3, reason: 'Stop new paid fallback reservations' };
  it.each([{}, null, { ...budget, capUsd: 10.01 }, { ...budget, capUsd: '0' }, { ...budget, capUsd: 0.001 }, { ...budget, expectedRevision: undefined }, { ...budget, expectedRevision: -1 }, { ...budget, actorUid: 'spoof' }, { ...budget, reason: 'short' }])('rejects malformed or over-ceiling budget %# without calling storage', async body => {
    const { handler, response } = setup(); await handler('POST', '/budget')({ body }, response);
    expect(response.status).toHaveBeenCalledWith(400); expect(mocks.budget).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('uses verified actor and records only the confirmed policy revision', async () => {
    const { handler, response } = setup(); const result = { ok: true, capUsd: 0, policyRevision: 4 }; mocks.budget.mockResolvedValue(result);
    await handler('POST', '/budget')({ body: budget }, response);
    expect(mocks.budget).toHaveBeenCalledWith(budget, 'verified-owner'); expect(response.json).toHaveBeenCalledWith(result);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_FREE_CHAT_CHAIN_BUDGET', { admin: 'verified-owner', controlTarget: 'free-chat-chain-paid-budget', ...budget, policyRevision: 4, result: 'ok' });
  });
  it.each([['FREE_CHAIN_BUDGET_CONFLICT', 409, 'conflict'], ['FREE_CHAIN_BUDGET_INVALID_INPUT', 400, 'invalid_input'], ['private upstream detail', 503, 'unconfirmed']])('maps %s without retry or success audit', async (code, status, result) => {
    const { handler, response } = setup(); mocks.budget.mockRejectedValue(new Error(String(code)));
    await handler('POST', '/budget')({ body: budget }, response);
    expect(response.status).toHaveBeenCalledWith(status); expect(mocks.budget).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith('ADMIN_FREE_CHAT_CHAIN_BUDGET_FAILED', expect.objectContaining({ result }));
    expect(mocks.audit).not.toHaveBeenCalledWith('ADMIN_FREE_CHAT_CHAIN_BUDGET', expect.anything()); expect(JSON.stringify(response.json.mock.calls)).not.toContain('private upstream');
  });
  it('redacts accidental secrets before durable setter and audit', async () => {
    const { handler, response } = setup(); const secret = 'sk-' + 's'.repeat(40); mocks.budget.mockResolvedValue({ ok: true, capUsd: 0, policyRevision: 4 });
    await handler('POST', '/budget')({ body: { ...budget, reason: `Emergency cap review ${secret}` } }, response);
    expect(JSON.stringify([mocks.budget.mock.calls, mocks.audit.mock.calls])).not.toContain(secret);
    expect(mocks.budget.mock.calls[0][0].reason).toContain('[REDACTED]');
  });
});
