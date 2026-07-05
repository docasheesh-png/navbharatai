import { describe, it, expect, beforeEach } from 'vitest';
import { loadQueue, mutateQueue, deleteQueue, __clearBuildQueueCacheForTests } from './BuildQueueStore';
import { enqueue, cancelItem, claimNext, completeRunning } from './BuildQueue';

// Under VITEST there is no Firestore (getDb → null), so the store runs its in-process fallback:
// mutateQueue applies the pure op against the cached queue and loadQueue reads it back. These tests
// verify that fallback is coherent (the route logic depends on it) without touching real Firestore.
describe('BuildQueueStore (in-process fallback, VITEST)', () => {
  beforeEach(() => __clearBuildQueueCacheForTests());

  it('starts empty and persists an enqueue across a load', async () => {
    expect((await loadQueue('ws1')).items).toEqual([]);
    await mutateQueue('ws1', (q) => enqueue(q, { id: 'a', prompt: 'do a', source: 'user', createdTs: 1 }).queue);
    const q = await loadQueue('ws1');
    expect(q.items.map((i) => [i.id, i.status])).toEqual([['a', 'pending']]);
  });

  it('sequences mutations (enqueue → claim → complete) coherently', async () => {
    await mutateQueue('ws1', (q) => enqueue(q, { id: 'a', prompt: 'p', source: 'planner', createdTs: 1 }).queue);
    await mutateQueue('ws1', (q) => enqueue(q, { id: 'b', prompt: 'p', source: 'advisor', createdTs: 2 }).queue);
    const claimed = (await mutateQueue('ws1', (q) => claimNext(q).queue));
    expect(claimed.items.find((i) => i.id === 'a')?.status).toBe('running');
    await mutateQueue('ws1', (q) => completeRunning(q, true));
    const done = await loadQueue('ws1');
    expect(done.items.find((i) => i.id === 'a')?.status).toBe('done');
    // 'b' is still pending and now claimable (serial slot free).
    expect(claimNext(done).claimed?.id).toBe('b');
  });

  it('cancel removes a pending item from execution', async () => {
    await mutateQueue('ws1', (q) => enqueue(q, { id: 'a', prompt: 'p', source: 'user', createdTs: 1 }).queue);
    await mutateQueue('ws1', (q) => cancelItem(q, 'a'));
    expect((await loadQueue('ws1')).items[0].status).toBe('cancelled');
  });

  it('keeps different workspaces isolated, and delete clears one', async () => {
    await mutateQueue('wsA', (q) => enqueue(q, { id: 'a', prompt: 'p', source: 'user', createdTs: 1 }).queue);
    await mutateQueue('wsB', (q) => enqueue(q, { id: 'b', prompt: 'p', source: 'user', createdTs: 1 }).queue);
    expect((await loadQueue('wsA')).items).toHaveLength(1);
    await deleteQueue('wsA');
    expect((await loadQueue('wsA')).items).toEqual([]);
    expect((await loadQueue('wsB')).items).toHaveLength(1); // untouched
  });
});
