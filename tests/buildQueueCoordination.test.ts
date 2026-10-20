import { describe, it, expect, afterEach, vi } from 'vitest';
import { createBuildQueueStore, BUILD_QUEUE_COLLECTION, QueueStoreUnavailableError, QueueClaimConflictError, BUILD_QUEUE_CALL_TIMEOUT_MS, __bindBuildQueueDbForTests, type QueueDb } from '../src/server/AgentV3/BuildQueueStore';
import { enqueue, serializeQueue, emptyQueue, type CommandQueue } from '../src/server/AgentV3/BuildQueue';
import { WORKSPACE_BUILD_LEASE_COLLECTION, LEASE_STALE_MS } from '../src/server/AgentV3/workspaceBuildLease';

const WS = 'agentv3-anon-queue-test';
const queueKey = `${BUILD_QUEUE_COLLECTION}/${WS}`;
const leaseKey = `${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`;
function database() {
  const docs = new Map<string, any>();
  const faults = { read: false, commit: false, lostAck: false, replay: undefined as (() => void) | undefined };
  let tail = Promise.resolve();
  const snap = (key: string) => ({ exists: docs.has(key), data: () => structuredClone(docs.get(key)) });
  const db: QueueDb = {
    collection: (name) => ({ doc: (id) => {
      const key = `${name}/${id}`;
      return { key, get: async () => { if (faults.read) throw Error('UNAVAILABLE'); return snap(key); }, delete: async () => { docs.delete(key); } };
    } }),
    runTransaction: (body) => {
      const next = tail.then(async () => {
        if (faults.read) throw Error('UNAVAILABLE');
        let writes = new Map<string, any>();
        const tx = { get: async (ref: any) => snap(ref.key), set: (ref: any, value: any) => { writes.set(ref.key, structuredClone(value)); } };
        let out = await body(tx);
        if (faults.replay) { const replay = faults.replay; faults.replay = undefined; replay(); writes = new Map(); out = await body(tx); }
        if (faults.commit) throw Error('commit failed');
        for (const [key, value] of writes) docs.set(key, value);
        if (faults.lostAck) { faults.lostAck = false; throw Error('commit acknowledgement lost'); }
        return out;
      });
      tail = next.then(() => undefined, () => undefined);
      return next;
    },
  };
  const queue = (q: CommandQueue) => docs.set(queueKey, { queue: serializeQueue(q) });
  const lease = (token: string, heartbeatAt = Date.now()) => docs.set(leaseKey, { token, owner: token, heartbeatAt });
  const add = async (id: string, prompt = id) => createBuildQueueStore(db).mutate(WS, (q) => { const r = enqueue(q, { id, prompt, source: 'user', createdTs: Date.now() }); return { queue: r.queue, result: r.added }; });
  return { docs, faults, db, queue, lease, add, a: createBuildQueueStore(db), b: createBuildQueueStore(db) };
}
afterEach(() => { __bindBuildQueueDbForTests(undefined); vi.useRealTimers(); });

describe('real database-shaped queue coordination (not VITEST fallback)', () => {
  it('a second instance sees enqueues and completion immediately, and preserves live running state', async () => {
    const f = database();
    expect((await f.a.load(WS)).items).toEqual([]);
    await f.add('A'); await f.add('B');
    expect((await f.a.load(WS)).items).toHaveLength(2);
    const first = await f.a.claim(WS, 'claim-A');
    expect(first.result?.id).toBe('A');
    expect((await f.b.load(WS)).items[0].status).toBe('running');
    expect((await f.b.claim(WS, 'claim-B')).result).toBeNull();
    f.lease('attempt-A');
    const binding = (await f.a.bind(WS, 'A', 'attempt-A')).result!;
    await f.a.settle(WS, binding, true);
    f.docs.delete(leaseKey);
    expect((await f.b.claim(WS, 'claim-B')).result?.id).toBe('B');
  });
  it('two competing instances claim only one item', async () => {
    const f = database(); await f.add('A'); await f.add('B');
    const both = await Promise.all([f.a.claim(WS, 'a'), f.b.claim(WS, 'b')]);
    expect(both.filter((r) => r.result)).toHaveLength(1);
  });
  it('returns only the final transaction callback result after a contention retry', async () => {
    const f = database(); await f.add('A');
    f.faults.replay = () => f.queue({ workspaceId: WS, items: [{ id: 'A', prompt: 'A', status: 'running', source: 'user', createdTs: 1, claimToken: 'other' }] });
    expect((await f.a.claim(WS, 'ours')).result).toBeNull();
  });
  it('never admits a queued command while a manual build owns the workspace', async () => {
    const f = database(); await f.add('A'); f.lease('manual');
    expect((await f.a.claim(WS)).result).toBeNull();
  });
  it('fails closed on absent DB, read failure, corrupt state and failed commits', async () => {
    const f = database();
    await expect(createBuildQueueStore(null).claim(WS)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    f.faults.read = true;
    await expect(f.a.load(WS)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    await expect(f.a.claim(WS)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    f.faults.read = false; f.faults.commit = true;
    await expect(f.add('A')).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    expect(f.docs.has(queueKey)).toBe(false);
    f.faults.commit = false; f.docs.set(queueKey, { queue: 'corrupt' });
    await expect(f.a.claim(WS)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
  });
  it('does not acknowledge or reapply a mutation when commit succeeded but acknowledgement was lost', async () => {
    const f = database(); f.faults.lostAck = true;
    await expect(f.add('same-request-id')).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    expect((await f.add('same-request-id')).result).toBe(false);
    expect((await f.a.load(WS)).items).toHaveLength(1);
  });
  it('binds legacy exact prompts once and rejects transport replay as a second attempt', async () => {
    const f = database(); await f.add('A'); await f.a.claim(WS, 'claim-A'); f.lease('attempt-A');
    const binding = (await f.a.bind(WS, 'A', 'attempt-A')).result!;
    expect(binding).toEqual({ itemId: 'A', claimToken: 'claim-A', attemptId: 'attempt-A' });
    f.lease('attempt-retry');
    await expect(f.b.bind(WS, 'A', 'attempt-retry')).rejects.toBeInstanceOf(QueueClaimConflictError);
  });
  it('checks explicit item/token and exact prompt; wrong lease cannot bind', async () => {
    const f = database(); await f.add('A'); await f.a.claim(WS, 'claim-A'); f.lease('attempt-A');
    await expect(f.a.bind(WS, 'A', 'attempt-A', { itemId: 'B' })).rejects.toBeInstanceOf(QueueClaimConflictError);
    await expect(f.a.bind(WS, 'A', 'attempt-A', { claimToken: 'other' })).rejects.toBeInstanceOf(QueueClaimConflictError);
    await expect(f.a.bind(WS, 'wrong prompt', 'attempt-A', { itemId: 'A' })).rejects.toBeInstanceOf(QueueClaimConflictError);
    await expect(f.a.bind(WS, 'A', 'wrong-attempt')).rejects.toBeInstanceOf(QueueClaimConflictError);
  });
  it('a delayed finalizer for A cannot settle B, even if both prompts are identical', async () => {
    const f = database(); await f.add('A', 'same'); await f.add('B', 'same');
    await f.a.claim(WS, 'claim-A'); f.lease('attempt-A');
    const a = (await f.a.bind(WS, 'same', 'attempt-A')).result!;
    await f.a.settle(WS, a, true); f.docs.delete(leaseKey);
    await f.b.claim(WS, 'claim-B'); f.lease('attempt-B');
    const b = (await f.b.bind(WS, 'same', 'attempt-B')).result!;
    expect((await f.a.settle(WS, a, false)).result).toBe(false);
    expect((await f.b.load(WS)).items[1].status).toBe('running');
    await f.b.settle(WS, b, true);
  });
  it('recovery needs explicit item identity, elapsed grace and a confirmed non-live lease; failure pauses', async () => {
    const f = database(); await f.add('A'); await f.add('B');
    const at = Date.now(); await f.a.claim(WS, 'claim-A', at);
    expect((await f.a.recover(WS, 'A', at + 1)).result).toBe(false);
    f.lease('live', at + LEASE_STALE_MS);
    expect((await f.b.recover(WS, 'A', at + LEASE_STALE_MS + 1)).result).toBe(false);
    f.docs.delete(leaseKey); f.faults.read = true;
    await expect(f.b.recover(WS, 'A', at + LEASE_STALE_MS + 1)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    f.faults.read = false;
    expect((await f.b.recover(WS, 'wrong-item', at + LEASE_STALE_MS + 1)).result).toBe(false);
    expect((await f.b.recover(WS, 'A', at + LEASE_STALE_MS + 1)).result).toBe(true);
    expect((await f.b.claim(WS)).result).toBeNull();
    expect((await f.b.claim(WS, 'reviewed', Date.now(), true)).result?.id).toBe('B');
  });
});

describe('uncertain and corrupt coordination is not interpreted as an empty queue', () => {
  it.each([
    { workspaceId: 'another-workspace', items: [] },
    { workspaceId: WS, items: [], paused: 'false' },
    { workspaceId: WS, items: [{ id: 'A', prompt: 'A', source: 'user', status: 'running', createdTs: 1, boundAttemptId: 42 }] },
    { workspaceId: WS, items: [{ id: 'A', prompt: 'A', source: 'user', status: 'running', createdTs: 1, claimToken: '' }] },
  ])('rejects malformed stored ownership/claim metadata %j', async (raw) => {
    const f = database(); f.docs.set(queueKey, { queue: JSON.stringify(raw) });
    await expect(f.a.claim(WS)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
  });
  it('a malformed lease is unknown rather than positive proof its holder is gone', async () => {
    const f = database(); await f.add('A'); await f.a.claim(WS, 'claim-A', 1);
    f.docs.set(leaseKey, { heartbeatAt: 'broken', token: 'A', owner: 'A' });
    await expect(f.b.recover(WS, 'A', Date.now())).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    expect((await f.a.load(WS)).items[0].status).toBe('running');
  });
});


describe('bounded durable queue calls', () => {
  it('a hanging real database operation reports uncertainty within the authority deadline', async () => {
    vi.useFakeTimers();
    const hanging: QueueDb = { collection: () => ({ doc: () => ({ get: () => new Promise(() => {}) }) }), runTransaction: () => new Promise(() => {}) };
    const store = createBuildQueueStore(hanging);
    const claim = expect(store.claim(WS)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    const read = expect(store.load(WS)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    await vi.advanceTimersByTimeAsync(BUILD_QUEUE_CALL_TIMEOUT_MS + 1);
    await Promise.all([claim, read]);
  });
});
