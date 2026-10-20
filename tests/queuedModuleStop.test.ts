import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { BUILD_QUEUE_COLLECTION, createBuildQueueStore, __bindBuildQueueDbForTests, type QueueDb } from '../src/server/AgentV3/BuildQueueStore';
import { serializeQueue } from '../src/server/AgentV3/BuildQueue';
import { WORKSPACE_BUILD_LEASE_COLLECTION } from '../src/server/AgentV3/workspaceBuildLease';

const verify = vi.hoisted(() => vi.fn(async (token: string) => {
  if (token === 'owner-token') return { uid: 'owner', email: 'owner@example.test' };
  if (token === 'other-token') return { uid: 'other', email: 'other@example.test' };
  throw Error('invalid signature');
}));
const conversationGet = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../src/server/lib/firebaseAdminModule', () => ({ loadFirebaseAdmin: async () => ({ apps: [{}], auth: () => ({ verifyIdToken: verify }) }) }));
vi.mock('../src/server/AgentV3/sharedConversationStore', () => ({ getConversationStore: () => ({ get: conversationGet }) }));

const WS = 'agentv3-owner-session123';
const ATTEMPT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NONCE = '11111111-1111-4111-8111-111111111111';
let routes: ReturnType<typeof captureRoutes>;
let setRunningBuild: (key: string, value: any) => void;
let local: any;
beforeAll(async () => {
  const mod = await import('../src/server/routes/agentv3');
  routes = captureRoutes(mod.registerAgentV3Routes);
  setRunningBuild = mod.__setRunningBuildForTest;
}, 30_000);
beforeEach(() => {
  vi.stubEnv('VITEST', ''); vi.stubEnv('AGENTV3_ENABLED', 'true'); vi.stubEnv('AGENTV3_ALLOWLIST', '');
  vi.clearAllMocks();
});
afterEach(() => {
  if (local) { local.exited = true; vi.stubEnv('VITEST', 'true'); setRunningBuild('owner', null); local = undefined; }
  __bindBuildQueueDbForTests(undefined); vi.unstubAllEnvs();
});
function fixture(workspaceId = WS, phase: 'ready' | 'pending' = 'ready', fail = false) {
  const docs = new Map<string, any>();
  const db: QueueDb = {
    collection: (name) => ({ doc: (id) => ({ key: `${name}/${id}`, get: async () => ({ exists: docs.has(`${name}/${id}`), data: () => structuredClone(docs.get(`${name}/${id}`)) }) }) }),
    runTransaction: async (body) => {
      if (fail) throw Error('UNAVAILABLE');
      const writes = new Map<string, any>();
      const deletes = new Set<string>();
      const value = await body({ get: (ref: any) => ref.get(), set: (ref: any, row: any) => writes.set(ref.key, structuredClone(row)), delete: (ref: any) => deletes.add(ref.key) });
      for (const key of deletes) docs.delete(key);
      for (const [key, row] of writes) docs.set(key, row);
      return value;
    },
  };
  docs.set(`${BUILD_QUEUE_COLLECTION}/${workspaceId}`, { queue: serializeQueue({ workspaceId, items: [
    { id: 'A', prompt: 'Build step A', status: 'running', source: 'planner', createdTs: 1, claimToken: 'claim-A', boundAttemptId: ATTEMPT,
      continuation: { version: 1, nonce: NONCE, predecessorAttemptId: ATTEMPT, phase, planRemaining: 2, ordinal: 1 } },
    { id: 'B', prompt: 'Build step B', status: 'pending', source: 'planner', createdTs: 2 },
  ] }) });
  __bindBuildQueueDbForTests(db);
  return { docs, store: createBuildQueueStore(db) };
}
async function stop(workspaceId = WS, token?: string) {
  const res = mockRes();
  await routes.get('POST /api/agentv3/stop')!(mockReq({ body: { workspaceId, userId: 'owner' }, headers: token ? { authorization: `Bearer ${token}` } : {} }), res);
  return res;
}
async function unsend(token = 'owner-token') {
  const res = mockRes();
  await routes.get('POST /api/agentv3/unsend')!(mockReq({ body: { workspaceId: WS, userId: 'owner' }, headers: { authorization: `Bearer ${token}` } }), res);
  return res;
}

describe('registered Stop cancels owner-authorized handoffs as well as active server windows', () => {
  it('cancels a READY handoff with no live lease and prevents reopen from consuming it', async () => {
    const f = fixture();
    expect((await stop(WS, 'owner-token')).body).toEqual({ stopped: true });
    expect(await f.store.load(WS)).toMatchObject({ paused: true, items: [{ id: 'A', status: 'failed' }, { id: 'B', status: 'pending' }] });
    expect((await f.store.load(WS)).items[0].continuation).toBeUndefined();
    expect(verify).toHaveBeenCalledWith('owner-token');
  });

  it('always cancels the durable pending handoff even when a local running build was stopped', async () => {
    const f = fixture(WS, 'pending');
    f.docs.set(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`, { token: ATTEMPT, owner: 'worker', heartbeatAt: Date.now() });
    local = { abort: new AbortController(), buffer: [], subscribers: new Set(), ended: false, startedTs: Date.now(), workspaceId: WS, userId: 'owner' };
    vi.stubEnv('VITEST', 'true'); setRunningBuild('owner', local); vi.stubEnv('VITEST', '');
    expect((await stop(WS, 'owner-token')).body).toEqual({ stopped: true });
    expect(local.abort.signal.aborted).toBe(true);
    expect((await f.store.load(WS)).paused).toBe(true);
    expect((await f.store.load(WS)).items[0].continuation).toBeUndefined();
    expect(f.docs.get(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`)).toMatchObject({ token: ATTEMPT, stopRequested: true });
  });

  it('a legacy Stop without workspaceId derives the retiring local predecessor workspace and atomically cancels it', async () => {
    const f = fixture(WS, 'pending');
    f.docs.set(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`, { token: ATTEMPT, owner: 'worker', heartbeatAt: Date.now() });
    local = { abort: new AbortController(), buffer: [], subscribers: new Set(), ended: true, exited: false,
      deliveryClose: Promise.resolve(true), startedTs: Date.now(), workspaceId: WS, userId: 'owner' };
    vi.stubEnv('VITEST', 'true'); setRunningBuild('owner', local); vi.stubEnv('VITEST', '');
    const res = mockRes();
    await routes.get('POST /api/agentv3/stop')!(mockReq({ body: { userId: 'owner' }, headers: { authorization: 'Bearer owner-token' } }), res);
    expect(res.body).toEqual({ stopped: true }); expect(local.abort.signal.aborted).toBe(true);
    expect((await f.store.load(WS)).items[0].continuation).toBeUndefined();
    expect(f.docs.get(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`)).toMatchObject({ stopRequested: true });
  });

  it.each([undefined, 'invalid-token', 'other-token'])('cannot cancel another private owner handoff by claiming body.userId (%s)', async (token) => {
    const f = fixture(); const before = structuredClone([...f.docs]);
    const res = await stop(WS, token);
    expect(res.body).toEqual({ stopped: false });
    expect([...f.docs]).toEqual(before);
  });

  it('preserves the established anonymous workspace capability policy', async () => {
    const workspaceId = 'agentv3-anon-session123'; const f = fixture(workspaceId);
    expect((await stop(workspaceId)).body).toEqual({ stopped: true });
    expect((await f.store.load(workspaceId)).paused).toBe(true);
  });

  it('reports an unconfirmed durable Stop as retryable instead of acknowledging cancellation', async () => {
    const f = fixture(WS, 'ready', true); const before = structuredClone([...f.docs]);
    const res = await stop(WS, 'owner-token');
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('2');
    expect(res.body).toMatchObject({ code: 'QUEUE_STORE_UNAVAILABLE', retryable: true });
    expect(res.body).not.toHaveProperty('stopped', true);
    expect([...f.docs]).toEqual(before);
  });

  it('Unsend also revokes a READY handoff before acknowledging the message take-back', async () => {
    const f = fixture();
    const res = await unsend();
    expect(res.statusCode).toBe(200); expect(res.body.ok).toBe(true);
    expect(await f.store.load(WS)).toMatchObject({ paused: true, items: [{ id: 'A', status: 'failed' }, { id: 'B', status: 'pending' }] });
    expect((await f.store.load(WS)).items[0].continuation).toBeUndefined();
  });

  it('Unsend cannot claim a purge while its durable continuation cancellation is unknown', async () => {
    fixture(WS, 'ready', true);
    const res = await unsend();
    expect(res.statusCode).toBe(503); expect(res.body).toMatchObject({ code: 'QUEUE_STORE_UNAVAILABLE', retryable: true });
    expect(res.body).not.toHaveProperty('ok', true);
    expect(conversationGet).not.toHaveBeenCalled();
  });
});
