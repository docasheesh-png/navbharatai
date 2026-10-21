import { beforeAll, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { __bindBuildQueueDbForTests, BUILD_QUEUE_COLLECTION, createBuildQueueStore, type QueueDb } from '../src/server/AgentV3/BuildQueueStore';
import { setServerDb } from '../src/server/lib/serverDb';
import * as leaseApi from '../src/server/AgentV3/workspaceBuildLease';
import * as actuatorFactory from '../src/server/routes/actuatorFactory';
import { reserveBuildRequest, completeBuildRequest, BUILD_REQUEST_COLLECTION } from '../src/server/lib/buildRequestReceipt';
import * as intentClassifier from '../src/server/AgentV3/IntentClassifier';
import { AIRouterManager } from '../src/server/AI/AIRouterManager';
import { serializeQueue } from '../src/server/AgentV3/BuildQueue';
import * as weakPreflight from '../src/server/AgentV3/weakBuildPreflight';
import { weakAdmissionReply } from '../src/server/AgentV3/weakBuildAdmission';
import * as liveSearch from '../src/server/lib/liveSearchContext';
import { clarityJudgeAsk } from '../src/server/AgentV3/clarityJudgeAsk';

// These are external ports, not the queue/lease/receipt lifecycle exercised below.
// Replace them before importing the route so a fixture can never call a real provider.
vi.mock('../src/server/AI/AIRouterManager', () => ({ AIRouterManager: { getRouter: vi.fn(() => { throw new Error('Unexpected router call before fixture setup'); }) } }));
vi.mock('../src/server/routes/actuatorFactory', () => ({ buildActuator: vi.fn(() => { throw new Error('Unexpected real builder invocation'); }) }));
vi.mock('../src/server/lib/liveSearchContext', () => ({ liveSearchContext: vi.fn(async () => '') }));
vi.mock('../src/server/AgentV3/weakBuildAdmissionAsk', () => ({ weakBuildAdmissionAsk: vi.fn(() => { throw new Error('Unexpected scope-provider call in queue fixture'); }) }));

// The preceding scope fixtures reach the clarity judge before scope refusal. A real SDK call
// there leaves an undici keep-alive timer that can be scheduled under the next test's fake clock.
vi.mock('../src/server/AgentV3/clarityJudgeAsk', () => ({ clarityJudgeAsk: vi.fn() }));

/** Keep a failing cleanup assertion actionable without clearing or draining any timer for it. */
function tracePendingTimers() {
  const key = (handle: unknown): unknown => typeof handle === 'object' && handle !== null && Symbol.toPrimitive in handle ? Number(handle) : handle;
  const pending = new Map<unknown, { kind: string; delay: unknown; stack: string | undefined }>();
  for (const kind of ['setTimeout', 'setInterval', 'setImmediate'] as const) {
    const schedule = globalThis[kind];
    vi.spyOn(globalThis, kind).mockImplementation(((callback: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      if (typeof callback !== 'function') return Reflect.apply(schedule, globalThis, [callback, ...args]);
      const stack = new Error('Timer allocated here').stack;
      let handle: unknown;
      const invoke = function (this: unknown, ...callbackArgs: unknown[]) {
        if (kind !== 'setInterval') pending.delete(key(handle));
        return callback.apply(this, callbackArgs);
      };
      handle = Reflect.apply(schedule, globalThis, [invoke, ...args]);
      pending.set(key(handle), { kind, delay: kind === 'setImmediate' ? undefined : args[0], stack });
      return handle;
    }) as never);
  }
  for (const kind of ['clearTimeout', 'clearInterval', 'clearImmediate'] as const) {
    const clear = globalThis[kind];
    vi.spyOn(globalThis, kind).mockImplementation(((handle: unknown) => {
      pending.delete(key(handle));
      return Reflect.apply(clear, globalThis, [handle]);
    }) as never);
  }
  return () => JSON.stringify([...pending.values()], null, 2);
}

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
    vi.mocked(clarityJudgeAsk).mockReset().mockResolvedValue('{"clear":true,"category":"general"}');
    const chatReply = 'Hello from the chat fixture.';
    const modelRoute = vi.fn(async () => ({ response: { content: chatReply, provider: 'fixture' } }));
    vi.spyOn(AIRouterManager, 'getRouter').mockReturnValue({ route: modelRoute } as never);
    vi.spyOn(liveSearch, 'liveSearchContext').mockResolvedValue('');
    const req = (body: any) => mockReq({ body: { userId: 'queue-route-owner', email: 'owner@example.test', planFirst: false, ...body }, headers: { 'x-test-verified-uid': 'queue-route-owner', 'x-test-verified-email': 'owner@example.test' } });
    const res: any = mockRes();
    const events: any[] = [];
    res.flushHeaders = () => { res.headersSent = true; };
    res.write = (line: string) => { events.push(JSON.parse(line)); return true; };
    return { req, res, events, modelRoute, chatReply };
  };
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); setServerDb(null); });
  it('a legacy greeting works without any build coordination database', async () => {
    const { req, res, events } = configure();
    await routes.get('POST /api/agentv3/chat')(req({ prompt: 'hello', sessionId: 'queue-chat-greeting' }), res);
    expect(res.statusCode).toBe(200);
    expect(events.some((e) => e.type === 'result' && e.ok === true)).toBe(true);
  });
  it.each(['strong', null] as const)('a queued Weak scope refusal (%s) fails its own step and keeps the next step paused', async (scope) => {
    const { req, res, events, modelRoute } = configure();
    const f = driver(); setServerDb(f.db as never);
    vi.stubEnv('AGENTV3_WEAK_SCOPE_POLICY', 'on');
    vi.stubEnv('GLM_API_KEY', 'unit-test-not-a-real-credential');
    vi.spyOn(intentClassifier, 'classifyIntentSmartDetailed').mockResolvedValue({ intent: 'new_build', readerAnswered: true, readerOutcome: 'answered', unclear: false });
    vi.spyOn(weakPreflight, 'weakAdmissionForTurn').mockResolvedValue({ scope, source: scope ? 'model' : 'unavailable' });
    const builder = vi.spyOn(actuatorFactory, 'buildActuator').mockImplementation(() => { throw Error('a scope refusal must not start a builder'); });
    const body = { prompt: 'Build a React task dashboard application with a search input and drag-and-drop task cards.', sessionId: `weak-queue-${scope ?? 'unknown'}`, requestId: '44444444-4444-4444-8444-444444444444', queueItemId: 'A', queueClaimToken: 'claim-A', powerLevel: 'weak' };
    const queuedWorkspace = `agentv3-queue-route-owner-${body.sessionId}`;
    f.docs.set(`${BUILD_QUEUE_COLLECTION}/${queuedWorkspace}`, { queue: serializeQueue({ workspaceId: queuedWorkspace, items: [
      { id: 'A', prompt: body.prompt, status: 'running', source: 'user', createdTs: Date.now(), claimedAt: Date.now(), claimToken: 'claim-A' },
      { id: 'B', prompt: 'Build the next roadmap step.', status: 'pending', source: 'user', createdTs: Date.now() + 1 },
    ] }) });

    await routes.get('POST /api/agentv3/chat')(req(body), res);

    // Read durable bytes first: a successful-looking terminal event must not advance the roadmap.
    const persisted = JSON.parse(f.docs.get(`${BUILD_QUEUE_COLLECTION}/${queuedWorkspace}`).queue);
    expect(persisted.items[0]).toMatchObject({ id: 'A', status: 'failed', claimToken: 'claim-A' });
    expect(persisted).toMatchObject({ paused: true, items: [expect.anything(), expect.objectContaining({ id: 'B', status: 'pending' })] });
    expect((await createBuildQueueStore(f.db).claim(queuedWorkspace, 'claim-B')).result).toBeNull();
    expect(f.docs.has(`${leaseApi.WORKSPACE_BUILD_LEASE_COLLECTION}/${queuedWorkspace}`)).toBe(false);
    const receipts = [...f.docs.entries()].filter(([key]) => key.startsWith(`${BUILD_REQUEST_COLLECTION}/`));
    expect(receipts).toHaveLength(1);
    expect(receipts[0][1]).toMatchObject({ state: 'terminal', outcome: 'failed', workspaceId: queuedWorkspace, ownerId: 'queue-route-owner' });
    const reply = weakAdmissionReply(scope);
    expect(events.find((e) => e.type === 'narration')).toMatchObject({ text: reply });
    expect(events.find((e) => e.type === 'done')).toMatchObject({ ok: false, summary: reply });
    expect(events.find((e) => e.type === 'result')).toMatchObject({ ok: false, summary: reply, steps: 0, billedUsd: 0, billedInr: 0 });
    expect(builder).not.toHaveBeenCalled();
    expect(modelRoute).not.toHaveBeenCalled();
    expect(clarityJudgeAsk).toHaveBeenCalledExactlyOnceWith(expect.any(String), body.prompt, expect.any(AbortSignal));
  });
  it('a normal queued chat completes only its own step, retains its reply and allows the next step', async () => {
    const { req, res, events, chatReply } = configure();
    const f = driver(); setServerDb(f.db as never);
    vi.stubEnv('AGENTV3_WEAK_SCOPE_POLICY', 'on');
    vi.stubEnv('GLM_API_KEY', 'unit-test-not-a-real-credential');
    vi.spyOn(intentClassifier, 'classifyIntentSmartDetailed').mockResolvedValue({ intent: 'chat', readerAnswered: true, readerOutcome: 'answered', unclear: false });
    vi.spyOn(weakPreflight, 'weakAdmissionForTurn').mockResolvedValue(null);
    const builder = vi.spyOn(actuatorFactory, 'buildActuator').mockImplementation(() => { throw Error('a chat must not start a builder'); });
    const body = { prompt: 'Hello, tell me a short friendly joke.', sessionId: 'normal-queued-chat', requestId: '55555555-5555-4555-8555-555555555555', queueItemId: 'A', queueClaimToken: 'claim-A', powerLevel: 'weak' };
    const queuedWorkspace = `agentv3-queue-route-owner-${body.sessionId}`;
    f.docs.set(`${BUILD_QUEUE_COLLECTION}/${queuedWorkspace}`, { queue: serializeQueue({ workspaceId: queuedWorkspace, items: [
      { id: 'A', prompt: body.prompt, status: 'running', source: 'user', createdTs: Date.now(), claimedAt: Date.now(), claimToken: 'claim-A' },
      { id: 'B', prompt: 'Build the next roadmap step.', status: 'pending', source: 'user', createdTs: Date.now() + 1 },
    ] }) });

    await routes.get('POST /api/agentv3/chat')(req(body), res);

    const persisted = JSON.parse(f.docs.get(`${BUILD_QUEUE_COLLECTION}/${queuedWorkspace}`).queue);
    expect(persisted.items[0]).toMatchObject({ id: 'A', status: 'done', claimToken: 'claim-A' });
    expect(persisted.items[1]).toMatchObject({ id: 'B', status: 'pending' });
    expect(persisted.paused).not.toBe(true);
    expect(f.docs.has(`${leaseApi.WORKSPACE_BUILD_LEASE_COLLECTION}/${queuedWorkspace}`)).toBe(false);
    expect((await createBuildQueueStore(f.db).claim(queuedWorkspace, 'claim-B')).result).toMatchObject({ id: 'B', status: 'running', claimToken: 'claim-B' });
    const receipts = [...f.docs.entries()].filter(([key]) => key.startsWith(`${BUILD_REQUEST_COLLECTION}/`));
    expect(receipts).toHaveLength(1);
    expect(receipts[0][1]).toMatchObject({ state: 'terminal', outcome: 'complete', workspaceId: queuedWorkspace });
    expect(events.find((e) => e.type === 'narration')).toMatchObject({ text: chatReply });
    expect(events.find((e) => e.type === 'done')).toMatchObject({ ok: true, summary: chatReply });
    expect(events.find((e) => e.type === 'result')).toMatchObject({ ok: true, summary: chatReply, steps: 0, billedUsd: 0, billedInr: 0 });
    expect(builder).not.toHaveBeenCalled();
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
    const pendingTimerDetails = tracePendingTimers();
    let release!: (value: any) => void;
    const held = new Promise<any>((resolve) => { release = resolve; });
    let markClassifierStarted!: () => void;
    const classifierStarted = new Promise<void>((resolve) => { markClassifierStarted = resolve; });
    const classified = vi.spyOn(intentClassifier, 'classifyIntentSmartDetailed').mockImplementation(() => { markClassifierStarted(); return held; });
    const request = routes.get('POST /api/agentv3/chat')(req({ prompt: 'Build a React weather dashboard application with a search input and a five day forecast.', sessionId: 'queue-chat-slow' }), res);
    await Promise.race([classifierStarted, request.then(() => { throw new Error('Request exited before reaching the held classifier'); })]);
    expect(classified).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1001);
    expect(res.headersSent).toBe(true);
    expect(events[0]).toMatchObject({ type: 'ping' });
    release({ intent: 'new_build', readerAnswered: true, readerOutcome: 'answered', unclear: false });
    await request;
    expect(events.some((e) => e.type === 'error' && e.code === 'BUILD_AUTHORITY_UNAVAILABLE')).toBe(true);
    expect(events.some((e) => e.type === 'result' && e.ok === false)).toBe(true);
    expect(clarityJudgeAsk).not.toHaveBeenCalled();
    expect(vi.getTimerCount(), pendingTimerDetails()).toBe(0);
    // afterEach restores the tracking spies before restoring real timers, including on failure.
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
