import { describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { SandboxStore, type SandboxRecord } from '../src/server/AgentV3/SandboxStore';
import { sandboxesToReap } from '../src/server/AgentV3/sandboxReaper';

const NOW = 100_000_000;
const old = (id: string, updatedAt = NOW - 60 * 60_000): SandboxRecord => ({
  workspaceId: id, userId: 'test-user', sandboxId: `machine-${id}`, updatedAt,
});

// Immutable document snapshots matter: Firestore cursors use the observed field values even if
// the underlying document changes or disappears before the next bounded sweep.
function fixture(initial: SandboxRecord[]) {
  const records = new Map(initial.map((r) => [r.workspaceId, { ...r }]));
  let failQuery = false;
  const queries: Array<{ limit: number; after?: string }> = [];
  const snapshot = (id: string, data: SandboxRecord | undefined) => {
    const copy = data ? { ...data } : undefined;
    return { id, exists: !!copy, data: () => copy };
  };
  type Snapshot = ReturnType<typeof snapshot>;
  const compare = (a: Snapshot, b: Snapshot) =>
    Number(b.data()?.updatedAt) - Number(a.data()?.updatedAt) || b.id.localeCompare(a.id);
  const update = vi.fn((ref: { id: string }, fields: object) => {
    records.set(ref.id, { ...records.get(ref.id)!, ...fields });
  });
  const db = {
    collection: vi.fn(() => ({
      doc: (id: string) => ({ id }),
      where: (field: string, op: string, cutoff: number) => {
        expect([field, op]).toEqual(['updatedAt', '<']);
        let limit = 50;
        let cursor: Snapshot | undefined;
        const query = {
          orderBy: (field: string, direction: string) => {
            expect([field, direction]).toEqual(['updatedAt', 'desc']);
            return query;
          },
          limit: (value: number) => { limit = value; return query; },
          startAfter: (value: Snapshot) => { cursor = value; return query; },
          get: async () => {
            queries.push({ limit, ...(cursor ? { after: cursor.id } : {}) });
            if (failQuery) throw new Error('temporary database failure');
            let docs = [...records].map(([id, r]) => snapshot(id, r))
              .filter((d) => Number(d.data()?.updatedAt) < cutoff).sort(compare);
            if (cursor) docs = docs.filter((d) => compare(d, cursor!) > 0);
            return { docs: docs.slice(0, limit) };
          },
        };
        return query;
      },
    })),
    runTransaction: vi.fn(async (run: (tx: object) => Promise<boolean>) => run({
      get: async (ref: { id: string }) => snapshot(ref.id, records.get(ref.id)),
      update,
    })),
  };
  return {
    records, queries, update, db,
    store: new SandboxStore(() => db as unknown as admin.firestore.Firestore),
    fail: (value: boolean) => { failQuery = value; },
  };
}

describe('the orphan scan advances without unbounded database reads', () => {
  it('reaches an orphan behind more than fifty already-paused records', async () => {
    const paused = Array.from({ length: 55 }, (_, n) => ({ ...old(`paused-${n}`, NOW - 30 * 60_000), pausedAt: NOW }));
    const f = fixture([...paused, old('orphan')]);
    const first = await f.store.listStale(NOW);
    const second = await f.store.listStale(NOW);
    expect(first).toHaveLength(50);
    expect(sandboxesToReap(first, NOW)).toEqual([]);
    expect(sandboxesToReap(second, NOW).map((r) => r.workspaceId)).toEqual(['orphan']);
    expect(f.queries.map((q) => q.limit)).toEqual([50, 50]);
  });

  it('timestamp ties cross pages without skipping or repeating documents', async () => {
    const all = Array.from({ length: 8 }, (_, n) => old(`same-${n}`));
    const f = fixture(all);
    const seen = [];
    for (let n = 0; n < 3; n++) seen.push(...await f.store.listStale(NOW, 3));
    expect(seen.map((r) => r.workspaceId).sort()).toEqual(all.map((r) => r.workspaceId).sort());
    await f.store.listStale(NOW, 3);
    expect(f.queries[3]?.after).toBeUndefined();
  });

  it('advances on raw malformed documents even when no candidate is returned', async () => {
    const f = fixture([old('a', 1), old('b', 2), old('c', 3)]);
    f.records.set('b', { ...old('wrong-id', 2) });
    f.records.set('c', { ...old('c', 3), sandboxId: '' });
    expect(await f.store.listStale(NOW, 2)).toEqual([]);
    expect((await f.store.listStale(NOW, 2)).map((r) => r.workspaceId)).toEqual(['a']);
  });

  it('keeps cursor progress after a failed read', async () => {
    const f = fixture([old('a', 1), old('b', 2), old('c', 3)]);
    await f.store.listStale(NOW, 1);
    f.fail(true);
    expect(await f.store.listStale(NOW, 1)).toEqual([]);
    f.fail(false);
    expect((await f.store.listStale(NOW, 1))[0]?.workspaceId).toBe('b');
    expect(f.queries[1]?.after).toBe('c');
    expect(f.queries[2]?.after).toBe('c');
  });

  it('cursor document mutation or deletion cannot shift the observed boundary', async () => {
    const f = fixture([old('a', 1), old('b', 2), old('c', 3)]);
    await f.store.listStale(NOW, 1);
    f.records.set('c', old('c', NOW + 1));
    expect((await f.store.listStale(NOW, 1))[0]?.workspaceId).toBe('b');
    f.records.delete('b');
    expect((await f.store.listStale(NOW, 1))[0]?.workspaceId).toBe('a');
  });

  it('wraps after an exact-size last page and sees newly stale records on the next cycle', async () => {
    const f = fixture([old('a', 1)]);
    await f.store.listStale(NOW, 1);
    f.records.set('new', old('new', 2));
    expect(await f.store.listStale(NOW, 1)).toEqual([]);
    expect((await f.store.listStale(NOW, 1))[0]?.workspaceId).toBe('new');
  });

  it('bounds every page, including invalid caller limits', async () => {
    const f = fixture([]);
    for (const limit of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 2.9, 10000]) await f.store.listStale(NOW, limit);
    expect(f.queries.map((q) => q.limit)).toEqual([50, 50, 1, 1, 2, 500]);
  });
});

describe('busy heartbeats preserve durable allocation identity', () => {
  it('the general touch path cannot overwrite a replacement allocation', async () => {
    const record = old('a');
    const f = fixture([record]);
    f.records.set('a', { ...record, sandboxId: 'new-machine' });

    await f.store.touch('a', record.sandboxId);

    expect(f.update).not.toHaveBeenCalled();
    expect(f.records.get('a')?.sandboxId).toBe('new-machine');
    expect(f.records.get('a')?.updatedAt).toBe(record.updatedAt);
  });

  it('the general touch path cannot recreate a cleared allocation', async () => {
    const record = old('a');
    const f = fixture([record]);
    f.records.delete('a');

    await f.store.touch('a', record.sandboxId);

    expect(f.update).not.toHaveBeenCalled();
    expect(f.records.has('a')).toBe(false);
  });

  it('refreshes only the timestamp of the existing matching allocation', async () => {
    const record = old('a');
    const f = fixture([record]);
    expect(await f.store.touchIfCurrent('a', record.sandboxId)).toBe(true);
    expect(f.update).toHaveBeenCalledWith({ id: 'a' }, { updatedAt: expect.any(Number) });
    expect(f.records.get('a')?.sandboxId).toBe(record.sandboxId);
    expect(f.records.get('a')?.userId).toBe(record.userId);
  });

  it.each(['replacement', 'deleted'] as const)('cannot overwrite or resurrect a %s allocation', async (change) => {
    const record = old('a');
    const f = fixture([record]);
    if (change === 'replacement') f.records.set('a', { ...record, sandboxId: 'new-machine' });
    else f.records.delete('a');
    expect(await f.store.touchIfCurrent('a', record.sandboxId)).toBe(false);
    expect(f.update).not.toHaveBeenCalled();
    expect(f.records.get('a')?.sandboxId).toBe(change === 'replacement' ? 'new-machine' : undefined);
  });

  it('leaves unavailable storage and invalid identity unchanged', async () => {
    const f = fixture([old('a')]);
    f.db.runTransaction.mockRejectedValueOnce(new Error('unavailable'));
    expect(await f.store.touchIfCurrent('a', 'machine-a')).toBe(false);
    expect(await f.store.touchIfCurrent('', 'machine-a')).toBe(false);
    expect(await f.store.touchIfCurrent('a', '')).toBe(false);
    expect(f.update).not.toHaveBeenCalled();
  });
});

describe('pause settlement describes only the allocation actually observed', () => {
  it('records a confirmed pause of the unchanged allocation', async () => {
    const record = old('a');
    const f = fixture([record]);
    expect(await f.store.markPausedIfUnchanged(record, 'orphan-sweep')).toBe(true);
    expect(f.update).toHaveBeenCalledWith({ id: 'a' }, { pausedAt: expect.any(Number), pausedBy: 'orphan-sweep' });
    expect(f.records.get('a')?.sandboxId).toBe(record.sandboxId);
    expect(f.records.get('a')?.updatedAt).toBe(record.updatedAt);
  });

  it.each(['replacement', 'activity', 'deleted'] as const)('never stamps a %s record', async (change) => {
    const record = old('a');
    const f = fixture([record]);
    if (change === 'replacement') f.records.set('a', { ...record, sandboxId: 'new-machine' });
    if (change === 'activity') f.records.set('a', { ...record, updatedAt: record.updatedAt + 1 });
    if (change === 'deleted') f.records.delete('a');
    expect(await f.store.markPausedIfUnchanged(record, 'idle-sweep')).toBe(false);
    expect(f.update).not.toHaveBeenCalled();
    if (change === 'deleted') expect(f.records.has('a')).toBe(false);
  });

  it('failed storage and invalid identity remain unconfirmed', async () => {
    const record = old('a');
    const f = fixture([record]);
    f.db.runTransaction.mockRejectedValueOnce(new Error('unavailable'));
    expect(await f.store.markPausedIfUnchanged(record, 'orphan-sweep')).toBe(false);
    expect(await f.store.markPausedIfUnchanged({ ...record, updatedAt: NaN }, 'orphan-sweep')).toBe(false);
    expect(f.update).not.toHaveBeenCalled();
  });
});
