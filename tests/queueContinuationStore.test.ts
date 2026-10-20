import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuildQueueStore, BUILD_QUEUE_COLLECTION, QueueClaimConflictError, QueueStoreUnavailableError, type QueueDb, type QueueBuildBinding } from '../src/server/AgentV3/BuildQueueStore';
import { emptyQueue, enqueue, serializeQueue, type CommandQueue } from '../src/server/AgentV3/BuildQueue';
import { WORKSPACE_BUILD_LEASE_COLLECTION, LEASE_STALE_MS } from '../src/server/AgentV3/workspaceBuildLease';

const WS = 'agentv3-owner-session123';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NONCE = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const queueKey = `${BUILD_QUEUE_COLLECTION}/${WS}`;
const leaseKey = `${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`;
const binding: QueueBuildBinding = { itemId: 'A', claimToken: 'claim-A', attemptId: A };

/** Buffered optimistic transactions retry on ANY read revision, including the lease document. */
function database() {
  const rows = new Map<string, any>();
  const versions = new Map<string, number>();
  const faults = { read: false, commit: false, lostAck: false, beforeCommit: undefined as undefined | (() => Promise<void>) };
  const put = (key: string, value: any) => { rows.set(key, structuredClone(value)); versions.set(key, (versions.get(key) ?? 0) + 1); };
  const remove = (key: string) => { rows.delete(key); versions.set(key, (versions.get(key) ?? 0) + 1); };
  const snapshot = (key: string) => {
    const value = structuredClone(rows.get(key));
    return { exists: value !== undefined, data: () => structuredClone(value) };
  };
  let retries = 0;
  const db: QueueDb = {
    collection: (name) => ({ doc: (id) => ({ key: `${name}/${id}`, get: async () => { if (faults.read) throw Error('UNAVAILABLE'); return snapshot(`${name}/${id}`); } }) }),
    async runTransaction(body) {
      for (let attempt = 0; attempt < 10; attempt++) {
        if (faults.read) throw Error('UNAVAILABLE');
        const reads = new Map<string, number>();
        const writes = new Map<string, any>();
        const deletes = new Set<string>();
        const result = await body({
          get: async (ref: any) => { if (writes.size || deletes.size) throw Error('read after write'); reads.set(ref.key, versions.get(ref.key) ?? 0); return snapshot(ref.key); },
          set: (ref: any, value: any) => { writes.set(ref.key, structuredClone(value)); },
          delete: (ref: any) => { deletes.add(ref.key); },
        });
        await faults.beforeCommit?.();
        if ([...reads].some(([key, version]) => (versions.get(key) ?? 0) !== version)) { retries++; continue; }
        if (faults.commit) throw Error('commit refused');
        for (const [key, value] of writes) put(key, value);
        for (const key of deletes) remove(key);
        if (faults.lostAck) { faults.lostAck = false; throw Error('committed acknowledgement lost'); }
        return result;
      }
      throw Error('contention retry limit');
    },
  };
  const queue = (q: CommandQueue) => put(queueKey, { queue: serializeQueue(q) });
  const lease = (token = A, extra: Record<string, unknown> = {}) => put(leaseKey, { token, owner: 'worker', heartbeatAt: Date.now(), ...extra });
  const a = createBuildQueueStore(db);
  const b = createBuildQueueStore(db);
  return { db, a, b, rows, faults, put, remove, queue, lease, retries: () => retries };
}
async function fixture() {
  const f = database();
  let q = emptyQueue(WS);
  for (const id of ['A', 'B']) q = enqueue(q, { id, prompt: `Build ${id}`, source: 'planner', createdTs: 1 }).queue;
  f.queue(q);
  await f.a.claim(WS, binding.claimToken);
  f.lease();
  expect((await f.a.bind(WS, 'Build A', A, { itemId: 'A', claimToken: binding.claimToken })).result).toEqual(binding);
  return f;
}
const expected = { itemId: 'A', claimToken: binding.claimToken, continuationNonce: NONCE, predecessorAttemptId: A, requestId: REQUEST };
async function ready(f: Awaited<ReturnType<typeof fixture>>) {
  const proposed = await f.a.proposeContinuation(WS, binding, 3, NONCE);
  expect(proposed.result.phase).toBe('pending');
  expect((await f.a.retireContinuation(WS, binding, NONCE)).result).toBe(true);
}
afterEach(() => vi.useRealTimers());

describe('normal queued module windows retain one logical command', () => {
  it('keeps A running and B blocked through pending, ready and consumed windows, then final success permits B', async () => {
    const f = await fixture();
    await f.a.proposeContinuation(WS, binding, 3, NONCE);
    expect((await f.b.load(WS)).items.map((i) => i.status)).toEqual(['running', 'pending']);
    expect((await f.b.claim(WS)).result).toBeNull();
    await f.a.retireContinuation(WS, binding, NONCE);
    expect(f.rows.has(leaseKey)).toBe(false);
    expect((await f.b.claim(WS)).result).toBeNull();
    f.lease(B);
    const successor = (await f.b.bind(WS, 'continue', B, expected)).result!;
    expect(successor).toEqual({ ...binding, attemptId: B });
    expect((await f.a.load(WS)).items[0]).toMatchObject({ status: 'running', boundAttemptId: B, continuationWindow: { nonce: NONCE, requestId: REQUEST, attemptId: B, ordinal: 1, planRemaining: 3 } });
    expect((await f.b.claim(WS)).result).toBeNull();
    expect((await f.a.settle(WS, successor, true)).result).toBe(true);
    f.remove(leaseKey);
    expect((await f.b.claim(WS)).result?.id).toBe('B');
  });

  it('only actual retirement atomically makes ready and deletes the predecessor lease', async () => {
    const f = await fixture(); await f.a.proposeContinuation(WS, binding, 3, NONCE);
    const before = structuredClone(f.rows);
    f.faults.commit = true;
    await expect(f.a.retireContinuation(WS, binding, NONCE)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    expect(f.rows).toEqual(before);
    f.faults.commit = false;
    await f.a.retireContinuation(WS, binding, NONCE);
    expect((await f.a.load(WS)).items[0].continuation?.phase).toBe('ready');
    expect(f.rows.has(leaseKey)).toBe(false);
  });

  it.each(['missing', 'stale', 'other', 'stopped'] as const)('cannot manufacture readiness from a %s predecessor lease', async (kind) => {
    const f = await fixture(); await f.a.proposeContinuation(WS, binding, 3, NONCE);
    if (kind === 'missing') f.remove(leaseKey);
    if (kind === 'stale') f.lease(A, { heartbeatAt: Date.now() - LEASE_STALE_MS - 1 });
    if (kind === 'other') f.lease(B);
    if (kind === 'stopped') f.lease(A, { stopRequested: true });
    const before = structuredClone(f.rows);
    expect((await f.a.retireContinuation(WS, binding, NONCE)).result).toBe(false);
    expect(f.rows).toEqual(before);
  });

  it('refuses an ordinary manual request in a continuation gap until explicit Stop cancels it', async () => {
    const f = await fixture(); await ready(f); f.lease(B);
    await expect(f.b.bind(WS, 'A newer manual edit', B)).rejects.toBeInstanceOf(QueueClaimConflictError);
    await f.a.stop(WS);
    f.remove(leaseKey); f.lease(C);
    expect((await f.b.bind(WS, 'A newer manual edit', C)).result).toBeNull();
    expect((await f.a.load(WS)).paused).toBe(true);
  });

  it('retains the anonymous capability path without requiring a private receipt request id', async () => {
    const f = await fixture(); await ready(f); f.lease(B);
    const { requestId: _requestId, ...anonymousExpected } = expected;
    expect((await f.b.bind(WS, 'continue', B, anonymousExpected)).result?.attemptId).toBe(B);
    expect((await f.a.load(WS)).items[0].continuationWindow).not.toHaveProperty('requestId');
  });
});

describe('continuation transfer preserves exact identity and durable progress bounds', () => {
  it.each([
    { itemId: 'B' }, { claimToken: 'wrong-claim' }, { continuationNonce: REQUEST },
    { predecessorAttemptId: C }, { requestId: 'invalid-request' }, { itemId: undefined }, { claimToken: undefined },
  ])('refuses altered ticket fields without changing either document: %j', async (change) => {
    const f = await fixture(); await ready(f); f.lease(B); const before = structuredClone(f.rows);
    await expect(f.b.bind(WS, 'continue', B, { ...expected, ...change })).rejects.toBeInstanceOf(QueueClaimConflictError);
    expect(f.rows).toEqual(before);
  });

  it.each(['Build a different app', 'please continue', ''])('does not use a ticket to authorize a different prompt: %j', async (prompt) => {
    const f = await fixture(); await ready(f); f.lease(B);
    await expect(f.b.bind(WS, prompt, B, expected)).rejects.toBeInstanceOf(QueueClaimConflictError);
  });

  it('refuses a pending ticket and same-attempt transfer', async () => {
    const f = await fixture(); await f.a.proposeContinuation(WS, binding, 3, NONCE);
    f.lease(B); await expect(f.b.bind(WS, 'continue', B, expected)).rejects.toBeInstanceOf(QueueClaimConflictError);
    f.lease(); await f.a.retireContinuation(WS, binding, NONCE); f.lease();
    await expect(f.a.bind(WS, 'continue', A, expected)).rejects.toBeInstanceOf(QueueClaimConflictError);
  });

  it('a replayed retirement acknowledgement never deletes a successor lease claimed in the ready gap', async () => {
    const f = await fixture(); await ready(f); f.lease(B);
    const successorLease = structuredClone(f.rows.get(leaseKey));
    expect((await f.a.retireContinuation(WS, binding, NONCE)).result).toBe(true);
    expect(f.rows.get(leaseKey)).toEqual(successorLease);
  });

  it('a copied ticket cannot consume or mutate the source workspace from another namespace', async () => {
    const f = await fixture(); await ready(f); f.lease(B);
    const before = structuredClone(f.rows);
    await expect(f.b.bind('agentv3-other-session123', 'continue', B, expected)).rejects.toBeInstanceOf(QueueClaimConflictError);
    expect(f.rows).toEqual(before);
  });

  it('never lets old callbacks settle, cancel, retire, or delete the successor lease', async () => {
    const f = await fixture(); await ready(f); f.lease(B); await f.b.bind(WS, 'continue', B, expected);
    const before = structuredClone(f.rows);
    expect((await f.a.settle(WS, binding, true)).result).toBe(false);
    expect((await f.a.cancelContinuation(WS, binding)).result).toBe(false);
    expect((await f.a.retireContinuation(WS, binding, NONCE)).result).toBe(false);
    await expect(f.a.bind(WS, 'continue', B, expected)).rejects.toBeInstanceOf(QueueClaimConflictError);
    expect(f.rows).toEqual(before);
  });

  it('requires strictly decreasing module count after a consumed window, including after a fresh store instance', async () => {
    const f = await fixture(); await ready(f); f.lease(B);
    const next = (await f.b.bind(WS, 'continue', B, expected)).result!;
    await expect(createBuildQueueStore(f.db).proposeContinuation(WS, next, 3)).rejects.toBeInstanceOf(QueueClaimConflictError);
    await expect(f.b.proposeContinuation(WS, next, 4)).rejects.toBeInstanceOf(QueueClaimConflictError);
    expect((await f.b.proposeContinuation(WS, next, 2)).result).toMatchObject({ phase: 'pending', ordinal: 2, planRemaining: 2, predecessorAttemptId: B });
  });

  it('does not reset the absolute continuation backstop after reload', async () => {
    const f = await fixture(); const q = await f.a.load(WS);
    q.items[0].continuationWindow = { version: 1, nonce: NONCE, predecessorAttemptId: B, attemptId: A, ordinal: 100, planRemaining: 3 };
    f.queue(q);
    await expect(createBuildQueueStore(f.db).proposeContinuation(WS, binding, 2)).rejects.toBeInstanceOf(QueueClaimConflictError);
  });
});

describe('Stop and failures serialize with queue and lease changes', () => {
  it.each(['pending', 'ready', 'consumed'] as const)('Stop cancels %s handoff and observes the current lease', async (phase) => {
    const f = await fixture(); await f.a.proposeContinuation(WS, binding, 3, NONCE);
    if (phase !== 'pending') await f.a.retireContinuation(WS, binding, NONCE);
    if (phase === 'consumed') { f.lease(B); await f.b.bind(WS, 'continue', B, expected); }
    const stopped = await f.b.stop(WS);
    expect(stopped.result).toEqual({ leaseStopped: phase !== 'ready', queuePaused: true });
    const q = await f.a.load(WS);
    expect(q.paused).toBe(true); expect(q.items[0].continuation).toBeUndefined(); expect(q.items[0].continuationWindow).toBeUndefined();
    if (phase !== 'ready') expect(f.rows.get(leaseKey)).toMatchObject({ token: phase === 'consumed' ? B : A, stopRequested: true });
    expect((await f.a.retireContinuation(WS, binding, NONCE)).result).toBe(false);
    f.lease(C);
    await expect(f.a.bind(WS, 'continue', C, expected)).rejects.toBeInstanceOf(QueueClaimConflictError);
    expect((await f.a.claim(WS)).result).toBeNull();
  });

  it('rolls back both queue cancellation and the stop flag when their transaction fails', async () => {
    const f = await fixture(); await f.a.proposeContinuation(WS, binding, 3, NONCE); const before = structuredClone(f.rows);
    f.faults.commit = true;
    await expect(f.b.stop(WS)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    expect(f.rows).toEqual(before);
  });

  it('late error after an intermediate result cancels that logical step, never authorizing a next window', async () => {
    const f = await fixture(); await f.a.proposeContinuation(WS, binding, 3, NONCE);
    expect((await f.a.cancelContinuation(WS, binding, 'Cleanup failed; review progress.')).result).toBe(true);
    expect((await f.a.retireContinuation(WS, binding, NONCE)).result).toBe(false);
    expect((await f.a.load(WS))).toMatchObject({ paused: true, items: [{ id: 'A', status: 'failed', note: 'Cleanup failed; review progress.' }, { id: 'B', status: 'pending' }] });
  });

  it('an unknown retirement acknowledgement can be reconciled by a fresh authoritative READY read', async () => {
    const f = await fixture(); await f.a.proposeContinuation(WS, binding, 3, NONCE); f.faults.lostAck = true;
    await expect(f.a.retireContinuation(WS, binding, NONCE)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    expect(f.rows.has(leaseKey)).toBe(false);
    expect((await f.b.load(WS)).items[0].continuation?.phase).toBe('ready');
    expect((await f.a.retireContinuation(WS, binding, NONCE)).result).toBe(true);
  });

  it('an unknown consumption acknowledgement never makes a ticket reusable', async () => {
    const f = await fixture(); await ready(f); f.lease(B); f.faults.lostAck = true;
    await expect(f.b.bind(WS, 'continue', B, expected)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    await expect(f.a.bind(WS, 'continue', B, expected)).rejects.toBeInstanceOf(QueueClaimConflictError);
    expect((await f.a.load(WS)).items[0]).toMatchObject({ boundAttemptId: B, continuationWindow: { requestId: REQUEST } });
  });
});

describe('optimistic contention returns only committed handoff authority', () => {
  it('admits only one of two consuming workers even with the same held lease', async () => {
    const f = await fixture(); await ready(f); f.lease(B);
    let arrived = 0; let release!: () => void; const both = new Promise<void>((resolve) => { release = resolve; });
    f.faults.beforeCommit = async () => { if (++arrived === 2) release(); await both; };
    const results = await Promise.allSettled([f.a.bind(WS, 'continue', B, expected), f.b.bind(WS, 'continue', B, expected)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: expect.any(QueueClaimConflictError) });
    expect(f.retries()).toBeGreaterThan(0);
  });

  it('a Stop committing during retirement forces callback retry and prevents readiness', async () => {
    const f = await fixture(); await f.a.proposeContinuation(WS, binding, 3, NONCE);
    let first = true;
    f.faults.beforeCommit = async () => {
      if (!first) return; first = false;
      await f.b.stop(WS);
    };
    expect((await f.a.retireContinuation(WS, binding, NONCE)).result).toBe(false);
    expect(f.rows.get(leaseKey)).toMatchObject({ token: A, stopRequested: true });
    expect(f.retries()).toBeGreaterThan(0);
  });

  it('Stop racing consumption retries against the successor and flags its current lease', async () => {
    const f = await fixture(); await ready(f); f.lease(B);
    let first = true;
    f.faults.beforeCommit = async () => {
      if (!first) return; first = false;
      await f.a.bind(WS, 'continue', B, expected);
    };
    expect((await f.b.stop(WS)).result).toEqual({ leaseStopped: true, queuePaused: true });
    expect(f.rows.get(leaseKey)).toMatchObject({ token: B, stopRequested: true });
    expect((await f.a.load(WS)).items[0]).toMatchObject({ status: 'running', boundAttemptId: B });
    expect(f.retries()).toBeGreaterThan(0);
  });
});

describe('new durable continuation records fail closed when malformed', () => {
  it.each([
    { phase: 'consumed' }, { nonce: 'unsafe' }, { predecessorAttemptId: C }, { planRemaining: 0 }, { planRemaining: 61 }, { ordinal: 101 }, { ordinal: NaN },
  ])('rejects altered pending metadata: %j', async (change) => {
    const f = await fixture(); await f.a.proposeContinuation(WS, binding, 3, NONCE);
    const raw = JSON.parse(f.rows.get(queueKey).queue); Object.assign(raw.items[0].continuation, change);
    f.put(queueKey, { queue: JSON.stringify(raw) });
    await expect(f.b.load(WS)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    await expect(f.b.stop(WS)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
  });

  it.each([{ attemptId: C }, { requestId: 'invalid' }, { ordinal: 0 }, { planRemaining: 61 }])('rejects altered consumed window metadata: %j', async (change) => {
    const f = await fixture(); await ready(f); f.lease(B); await f.b.bind(WS, 'continue', B, expected);
    const raw = JSON.parse(f.rows.get(queueKey).queue); Object.assign(raw.items[0].continuationWindow, change);
    f.put(queueKey, { queue: JSON.stringify(raw) });
    await expect(f.b.load(WS)).rejects.toBeInstanceOf(QueueStoreUnavailableError);
  });
});
