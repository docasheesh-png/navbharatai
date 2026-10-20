import { afterEach, describe, expect, it } from 'vitest';
import { createBuildRequestCoordination } from '../src/server/AgentV3/BuildRequestCoordination';
import { createBuildQueueStore, __bindBuildQueueDbForTests, BUILD_QUEUE_COLLECTION } from '../src/server/AgentV3/BuildQueueStore';
import { enqueue } from '../src/server/AgentV3/BuildQueue';
import { BUILD_REQUEST_COLLECTION, reserveBuildRequest } from '../src/server/lib/buildRequestReceipt';
import { claimWorkspaceBuild, WORKSPACE_BUILD_LEASE_COLLECTION } from '../src/server/AgentV3/workspaceBuildLease';

const WS = 'agentv3-owner-session123';
const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const input = { requestId: REQUEST, sessionId: 'session123', queueItemId: 'A', queueClaimToken: 'claim-A', message: 'Build step A' };

function database() {
  const docs = new Map<string, any>();
  let delayQueueCommit: Promise<void> | undefined;
  const snapshot = (ref: { key: string }) => ({ exists: docs.has(ref.key), data: () => structuredClone(docs.get(ref.key)) });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => {
      const ref = { key: `${name}/${id}`, get: async () => snapshot(ref) };
      return ref;
    } }),
    runTransaction: async <T>(body: (tx: any) => Promise<T>): Promise<T> => {
      const writes = new Map<string, any>();
      const result = await body({
        get: async (ref: { key: string }) => snapshot(ref),
        set: (ref: { key: string }, value: unknown) => { writes.set(ref.key, structuredClone(value)); },
        delete: (ref: { key: string }) => { writes.set(ref.key, undefined); },
      });
      if (writes.has(`${BUILD_QUEUE_COLLECTION}/${WS}`)) await delayQueueCommit;
      for (const [key, value] of writes) {
        if (value === undefined) docs.delete(key); else docs.set(key, value);
      }
      return result;
    },
  };
  return { db, docs, delayQueueCommit: (promise: Promise<void>) => { delayQueueCommit = promise; } };
}

afterEach(() => { __bindBuildQueueDbForTests(undefined); });

describe('deadline publication is separate from retiring request identity', () => {
  it('waits for the queued terminal before stream close, while the receipt and lease stay held until body cleanup', async () => {
    const f = database();
    __bindBuildQueueDbForTests(f.db);
    const queue = createBuildQueueStore(f.db);
    await queue.mutate(WS, (state) => {
      const added = enqueue(state, { id: 'A', prompt: 'Build step A', source: 'planner', createdTs: Date.now() });
      return { queue: added.queue, result: added.added };
    });
    await queue.claim(WS, 'claim-A');
    expect(await claimWorkspaceBuild(f.db, { workspaceId: WS, token: ATTEMPT, owner: 'worker-A' })).toMatchObject({ ok: true });
    const request = createBuildRequestCoordination({ workspaceId: WS, ownerId: 'owner', attemptId: ATTEMPT,
      input, prompt: () => 'Build step A', store: () => f.db });
    expect(await request.admit()).toBeNull();
    const receiptKey = [...f.docs.keys()].find((key) => key.startsWith(`${BUILD_REQUEST_COLLECTION}/`))!;
    expect(f.docs.get(receiptKey).state).toBe('running');

    let finishQueueCommit!: () => void;
    f.delayQueueCommit(new Promise<void>((resolve) => { finishQueueCommit = resolve; }));
    const order: string[] = [];
    request.publish({ type: 'result', ok: false, resumable: false, code: 'BUILD_STILL_STOPPING' }, () => order.push('result'));
    const closing = request.flushPublication().then(() => { order.push('closed'); });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]);
    expect(f.docs.get(receiptKey).state).toBe('running');
    finishQueueCommit();
    await closing;
    expect(order).toEqual(['result', 'closed']);
    expect(f.docs.get(receiptKey).state).toBe('running');
    expect(f.docs.get(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`).token).toBe(ATTEMPT);
    expect(await reserveBuildRequest(f.db, { ownerId: 'owner', workspaceId: WS, requestId: REQUEST, attemptId: ATTEMPT, input })).toMatchObject({ ok: false, code: 'in-progress' });
    expect(await claimWorkspaceBuild(f.db, { workspaceId: WS, token: 'new-request-attempt', owner: 'worker-B' })).toMatchObject({ ok: false, reason: 'busy' });

    // Only the actual body's release retires its receipt; flushPublication never does so.
    await request.release();
    expect(f.docs.get(receiptKey)).toMatchObject({ state: 'terminal', outcome: 'failed' });
    expect(await reserveBuildRequest(f.db, { ownerId: 'owner', workspaceId: WS, requestId: REQUEST, attemptId: ATTEMPT, input })).toMatchObject({ ok: false, code: 'terminal' });
  });
});
