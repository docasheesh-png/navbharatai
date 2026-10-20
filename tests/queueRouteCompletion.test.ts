import { beforeAll, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { __bindBuildQueueDbForTests, BUILD_QUEUE_COLLECTION, type QueueDb } from '../src/server/AgentV3/BuildQueueStore';
import { setServerDb } from '../src/server/lib/serverDb';
import * as leaseApi from '../src/server/AgentV3/workspaceBuildLease';
import * as actuatorFactory from '../src/server/routes/actuatorFactory';
import { reserveBuildRequest, completeBuildRequest, BUILD_REQUEST_COLLECTION } from '../src/server/lib/buildRequestReceipt';
import * as intentClassifier from '../src/server/AgentV3/IntentClassifier';
import { AIRouterManager } from '../src/server/AI/AIRouterManager';
import { serializeQueue } from '../src/server/AgentV3/BuildQueue';

let routes: Map<string, any>;
const savedEnv = { ...process.env };
afterAll(() => { for (const key of ['AGENTV3_ENABLED', 'AGENTV3_ALLOWLIST', 'AGENTV3_FREE_LIST', 'ANTHROPIC_API_KEY', 'NODE_ENV']) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; } });
beforeAll(async () => { const mod = await import('../src/server/routes/agentv3'); routes = captureRoutes(mod.registerAgentV3Routes); }, 30_000);
afterEach(() => __bindBuildQueueDbForTests(undefined));
const workspaceId = 'agentv3-anon-queue-route';
function driver(fail = false) {
  const docs = new Map<string, any>();
  let writes = 0;
  const db: QueueDb = {
    collection: (name) => ({ doc: (id) => { const key = `${name}/${id}`; return { key, get: async () => { if (fail) throw Error('UNAVAILABLE'); return { exists: docs.has(key), data: () => structuredClone(docs.get(key)) }; } }; } }),
    runTransaction: async (body) => { if (fail) throw Error('UNAVAILABLE'); return body({ get: (ref: any) => ref.get(), set: (ref: any, value: any) => { writes++; docs.set(ref.key, value); }, delete: (ref: any) => { docs.delete(ref.key); } }); },
  };
  __bindBuildQueueDbForTests(db);
  return { db, docs, writes: () => writes };
}
describe('v1 queue routes retain legacy requests without trusting client completion', () => {
  it.each([{}, { itemId: 'A', claimToken: 'claim-A' }])('delayed legacy/identified A completion cannot settle B: %j', async (extra) => {
    const f = driver();
    f.docs.set(`${BUILD_QUEUE_COLLECTION}/${workspaceId}`, { queue: serializeQueue({ workspaceId, items: [
      { id: 'A', prompt: 'same', status: 'done', source: 'user', createdTs: 1, claimToken: 'claim-A', boundAttemptId: 'attempt-A' },
      { id: 'B', prompt: 'same', status: 'running', source: 'user', createdTs: 2, claimToken: 'claim-B', boundAttemptId: 'attempt-B' },
    ] }) });
    const res = mockRes();
    await routes.get('POST /api/agentv3/queue/complete')(mockReq({ body: { workspaceId, ok: false, note: 'old A failed', ...extra } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.items[1]).toMatchObject({ id: 'B', status: 'running', boundAttemptId: 'attempt-B' });
    expect(f.writes()).toBe(0);
  });
  it.each(['next', 'enqueue', 'complete', 'recover'])('returns a retryable failure rather than a fake success when /%s cannot reach storage', async (route) => {
    driver(true);
    const res = mockRes();
    await routes.get(`POST /api/agentv3/queue/${route}`)(mockReq({ body: { workspaceId, prompt: 'approved step', id: 'A' } }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'QUEUE_STORE_UNAVAILABLE', retryable: true });
    expect(res.headers['retry-after']).toBe('2');
  });
});


describe('build admission preserves read-only chat and refuses uncertain mutation before streaming', () => {
  const configure = () => {
    process.env.AGENTV3_ENABLED = 'true'; process.env.AGENTV3_ALLOWLIST = ''; process.env.AGENTV3_FREE_LIST = 'queue-route-owner';
    process.env.ANTHROPIC_API_KEY = 'unit-test-not-a-real-credential'; process.env.NODE_ENV = 'test';
    setServerDb(null);
    vi.spyOn(AIRouterManager, 'getRouter').mockReturnValue({ route: async () => ({ response: { content: 'Hello from the chat fixture.', provider: 'fixture' } }) } as never);
    const req = (body: any) => mockReq({ body: { userId: 'queue-route-owner', email: 'owner@example.test', planFirst: false, ...body }, headers: { 'x-test-verified-uid': 'queue-route-owner', 'x-test-verified-email': 'owner@example.test' } });
    const res: any = mockRes();
    const events: any[] = [];
    res.flushHeaders = () => { res.headersSent = true; };
    res.write = (line: string) => { events.push(JSON.parse(line)); return true; };
    return { req, res, events };
  };
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  it('a legacy greeting works without any build coordination database', async () => {
    const { req, res, events } = configure();
    await routes.get('POST /api/agentv3/chat')(req({ prompt: 'hello', sessionId: 'queue-chat-greeting' }), res);
    expect(res.statusCode).toBe(200);
    expect(events.some((e) => e.type === 'result' && e.ok === true)).toBe(true);
  });
  it('a real build is refused before headers when ownership cannot be confirmed', async () => {
    const { req, res, events } = configure();
    await routes.get('POST /api/agentv3/chat')(req({ prompt: 'Build a React weather dashboard application with a search input and a five day forecast.', sessionId: 'queue-chat-build' }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('BUILD_AUTHORITY_UNAVAILABLE');
    expect(res.headersSent).toBe(false);
    expect(events).toEqual([]);
  });
  it('a slow read-only classifier publishes a ping within one second, then refuses unavailable authority without a builder run', async () => {
    const { req, res, events } = configure();
    vi.useFakeTimers();
    let release!: (value: any) => void;
    const held = new Promise<any>((resolve) => { release = resolve; });
    const classified = vi.spyOn(intentClassifier, 'classifyIntentSmartDetailed').mockReturnValue(held);
    const request = routes.get('POST /api/agentv3/chat')(req({ prompt: 'Build a React weather dashboard application with a search input and a five day forecast.', sessionId: 'queue-chat-slow' }), res);
    for (let i = 0; i < 100 && !classified.mock.calls.length; i++) await Promise.resolve();
    expect(classified).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1001);
    expect(res.headersSent).toBe(true);
    expect(events[0]).toMatchObject({ type: 'ping' });
    release({ intent: 'new_build', readerAnswered: true, readerOutcome: 'answered', unclear: false });
    await request;
    expect(events.some((e) => e.type === 'error' && e.code === 'BUILD_AUTHORITY_UNAVAILABLE')).toBe(true);
    expect(events.some((e) => e.type === 'result' && e.ok === false)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
  it('deterministic admission failure leaves the same request UUID usable on a later admitted retry', async () => {
    const first = configure();
    const f = driver(); setServerDb(f.db as never);
    const realClaim = leaseApi.claimWorkspaceBuild;
    vi.spyOn(leaseApi, 'claimWorkspaceBuild').mockResolvedValueOnce({ ok: false, reason: 'unavailable', holderHeartbeatAt: 0 }).mockImplementation(realClaim);
    const builder = vi.spyOn(actuatorFactory, 'buildActuator').mockImplementation(() => { throw Error('trusted fixture execution boundary'); });
    const body = { prompt: 'Build a React weather dashboard application with a search input and a five day forecast.', sessionId: 'receipt-retry-session', requestId: '11111111-1111-4111-8111-111111111111' };
    await routes.get('POST /api/agentv3/chat')(first.req(body), first.res);
    expect(first.res.statusCode).toBe(503);
    expect([...f.docs.keys()].some((k) => k.startsWith(BUILD_REQUEST_COLLECTION + '/'))).toBe(false);
    expect(builder).not.toHaveBeenCalled();
    const res: any = mockRes(); res.flushHeaders = () => { res.headersSent = true; }; res.write = () => true;
    await expect(routes.get('POST /api/agentv3/chat')(first.req(body), res)).rejects.toThrow('trusted fixture execution boundary');
    expect(builder).toHaveBeenCalledTimes(1);
    const receipts = [...f.docs.entries()].filter(([k]) => k.startsWith(BUILD_REQUEST_COLLECTION + '/'));
    expect(receipts).toHaveLength(1);
    // Even an unexpected exception before the inner build try must close the accepted attempt.
    expect(receipts[0][1]).toMatchObject({ state: 'terminal', outcome: 'unknown' });
  });
  it('a terminal request receipt prevents another builder execution', async () => {
    const { req, res } = configure(); const f = driver(); setServerDb(f.db as never);
    const body = { prompt: 'Build a React weather dashboard application with a search input and a five day forecast.', sessionId: 'receipt-replay-session', requestId: '22222222-2222-4222-8222-222222222222' };
    const request = req(body);
    const prior = await reserveBuildRequest(f.db, { ownerId: 'queue-route-owner', workspaceId: 'agentv3-queue-route-owner-receipt-replay-session', requestId: body.requestId, attemptId: '33333333-3333-4333-8333-333333333333', input: request.body });
    if (!prior.ok) throw Error('fixture receipt was not created');
    await completeBuildRequest(f.db, prior.receipt, 'complete');
    const replayWorkspace = 'agentv3-queue-route-owner-receipt-replay-session';
    f.docs.set(`${BUILD_QUEUE_COLLECTION}/${replayWorkspace}`, { queue: serializeQueue({ workspaceId: replayWorkspace, items: [
      { id: 'new-same-prompt-step', prompt: body.prompt, status: 'running', source: 'user', createdTs: Date.now(), claimToken: 'new-claim', claimedAt: Date.now() },
    ] }) });
    const queueBefore = structuredClone(f.docs.get(`${BUILD_QUEUE_COLLECTION}/${replayWorkspace}`));
    const builder = vi.spyOn(actuatorFactory, 'buildActuator');
    await routes.get('POST /api/agentv3/chat')(request, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('BUILD_REQUEST_TERMINAL');
    expect(builder).not.toHaveBeenCalled();
    expect(f.docs.get(`${BUILD_QUEUE_COLLECTION}/${replayWorkspace}`)).toEqual(queueBefore);
  });
  it('request identity requires a stable session rather than allocating a new workspace on every retry', async () => {
    const { req, res } = configure();
    await routes.get('POST /api/agentv3/chat')(req({ prompt: 'hello', requestId: '11111111-1111-4111-8111-111111111111' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('BUILD_REQUEST_INVALID');
    expect(res.headersSent).toBe(false);
  });
});
