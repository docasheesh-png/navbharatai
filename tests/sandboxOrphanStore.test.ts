import { describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { RETAINED_INDEFINITELY, USER_SCOPED_COLLECTIONS } from '../src/server/lib/DataRetentionManager';
import { WORKSPACE_SCOPED_COLLECTIONS } from '../src/server/lib/workspaceDataErase';
import { SandboxStore, sandboxOrphanDocumentId } from '../src/server/AgentV3/SandboxStore';

function orphanFixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        id,
        name,
        get: async () => {
          const row = rows.get(id);
          return { exists: !!row, data: () => row ? { ...row } : undefined };
        },
        set: async (fields: Record<string, unknown>, options?: { merge?: boolean }) => {
          rows.set(id, options?.merge ? { ...(rows.get(id) ?? {}), ...fields } : { ...fields });
        },
      }),
      where: (field: string, op: string, value: string) => {
        expect([name, field, op, value]).toEqual(['agentv3_sandbox_orphans', 'status', '==', 'pending']);
        const makeQuery = (after: string | null = null, max = 50): any => ({
          __isQuery: true,
          orderBy: () => makeQuery(after, max),
          startAfter: (id: string) => makeQuery(id, max),
          limit: (n: number) => makeQuery(after, n),
          run: async () => ({
            docs: [...rows.entries()]
              .filter(([id, row]) => row.status === 'pending' && (!after || id > after))
              .sort(([a], [b]) => a.localeCompare(b))
              .slice(0, max)
              .map(([id, row]) => ({ id, data: () => ({ ...row }) })),
          }),
        });
        return makeQuery();
      },
    }),
    runTransaction: vi.fn(async (run: (tx: object) => Promise<unknown>) => run({
      get: async (ref: { id?: string; __isQuery?: boolean; run?: () => Promise<unknown> }) => {
        if (ref.__isQuery && ref.run) return ref.run();
        const row = ref.id ? rows.get(ref.id) : undefined;
        return { exists: !!row, data: () => row ? { ...row } : undefined };
      },
      set: (ref: { id: string }, fields: Record<string, unknown>, options?: { merge?: boolean }) => {
        rows.set(ref.id, options?.merge ? { ...(rows.get(ref.id) ?? {}), ...fields } : { ...fields });
      },
      delete: (ref: { id: string }) => { rows.delete(ref.id); },
      update: (ref: { id: string }, fields: Record<string, unknown>) => {
        rows.set(ref.id, { ...(rows.get(ref.id) ?? {}), ...fields });
      },
    })),
  };
  return {
    rows,
    store: new SandboxStore(() => db as unknown as admin.firestore.Firestore),
  };
}

describe('durable untracked sandbox orphan records', () => {
  it('persists a pending orphan, increments retry attempts, and marks it handled', async () => {
    const f = orphanFixture();
    expect(await f.store.recordOrphanAllocation('machine-loser', 'losing-allocation')).toBe(true);
    expect(await f.store.listPendingOrphanAllocations()).toEqual([{
      sandboxId: 'machine-loser',
      reason: 'losing-allocation',
      attempts: 0,
    }]);

    await f.store.noteOrphanAllocationAttempt('machine-loser');
    expect((await f.store.listPendingOrphanAllocations())[0]?.attempts).toBe(1);

    expect(await f.store.markOrphanAllocationHandled('machine-loser', 'paused')).toBe(true);
    expect(await f.store.listPendingOrphanAllocations()).toEqual([]);
  });

  it('does not reopen an orphan that is already paused or killed', async () => {
    const f = orphanFixture();
    await f.store.recordOrphanAllocation('machine-loser', 'losing-allocation');
    await f.store.markOrphanAllocationHandled('machine-loser', 'killed');
    expect(await f.store.recordOrphanAllocation('machine-loser', 'losing-allocation')).toBe(true);
    expect(await f.store.listPendingOrphanAllocations()).toEqual([]);
    expect(f.rows.get(sandboxOrphanDocumentId('machine-loser'))?.status).toBe('killed');
  });

  it('rotates through more than one page so pending orphans cannot starve', async () => {
    const f = orphanFixture();
    for (let i = 0; i < 60; i += 1) {
      const id = `machine-${String(i).padStart(2, '0')}`;
      expect(await f.store.recordOrphanAllocation(id, 'losing-allocation')).toBe(true);
    }

    const first = await f.store.listPendingOrphanAllocations(50);
    const second = await f.store.listPendingOrphanAllocations(50);
    const wrapped = await f.store.listPendingOrphanAllocations(50);
    expect(first).toHaveLength(50);
    expect(new Set(first.map(row => row.sandboxId)).size).toBe(50);
    expect(second).toHaveLength(10);
    expect(new Set([...first, ...second].map(row => row.sandboxId)).size).toBe(60);
    expect(wrapped).toHaveLength(50);
    expect(wrapped).toEqual(first);
  });

  it('retains only necessary pending cleanup identity, then strips every identity field on resolution', async () => {
    const f = orphanFixture();
    const id = sandboxOrphanDocumentId('machine-loser');
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    await f.store.recordOrphanAllocation('machine-loser', 'losing-allocation');
    expect(Object.keys(f.rows.get(id)!).sort()).toEqual(['attempts', 'createdAt', 'reason', 'sandboxId', 'status', 'updatedAt']);
    // Even stale extra metadata must be removed, not retained by a merge update.
    f.rows.set(id, { ...f.rows.get(id), workspaceId: 'private-workspace', userId: 'private-owner' });
    expect(await f.store.markOrphanAllocationHandled('machine-loser', 'killed')).toBe(true);
    expect(f.rows.get(id)).toEqual({ status: 'killed', resolvedAt: expect.any(Number) });
    await f.store.noteOrphanAllocationAttempt('machine-loser');
    await f.store.recordOrphanAllocation('machine-loser', 'unrecorded-allocation');
    expect(f.rows.get(id)).toEqual({ status: 'killed', resolvedAt: expect.any(Number) });
    expect(await f.store.markOrphanAllocationHandled('machine-loser', 'paused')).toBe(true);
    expect(f.rows.get(id)?.status).toBe('killed');
  });

  it.each(['read', 'retry', 'handled', 'enqueue'] as const)('migrates legacy pending identity safely on %s', async (action) => {
    const f = orphanFixture(); const sandboxId = 'legacy-provider-machine';
    f.rows.set(sandboxId, { sandboxId, workspaceId: 'private-workspace', userId: 'private-user', reason: 'private free text', status: 'pending', attempts: 2 });
    f.rows.set('navbharatai-orphan-sweep-cursor-v1', { lastDocumentId: sandboxId });
    if (action === 'read') expect((await f.store.listPendingOrphanAllocations())[0]?.sandboxId).toBe(sandboxId);
    if (action === 'retry') await f.store.noteOrphanAllocationAttempt(sandboxId);
    if (action === 'handled') expect(await f.store.markOrphanAllocationHandled(sandboxId, 'killed')).toBe(true);
    if (action === 'enqueue') await f.store.recordOrphanAllocation(sandboxId, 'losing-allocation');
    expect(f.rows.has(sandboxId)).toBe(false);
    const saved = f.rows.get(sandboxOrphanDocumentId(sandboxId));
    expect(saved).not.toHaveProperty('workspaceId'); expect(saved).not.toHaveProperty('userId');
    expect(JSON.stringify([...f.rows])).not.toContain('private');
    if (action === 'handled') expect(JSON.stringify([...f.rows])).not.toContain(sandboxId);
    else expect(saved?.sandboxId).toBe(sandboxId);
  });

  it('a terminal digest fence dominates a stale legacy pending row without reopening it', async () => {
    const f = orphanFixture(); const id = 'machine-loser';
    await f.store.recordOrphanAllocation(id, 'losing-allocation');
    await f.store.markOrphanAllocationHandled(id, 'killed');
    f.rows.set(id, { sandboxId: id, workspaceId: 'private', status: 'pending' });
    expect(await f.store.listPendingOrphanAllocations()).toEqual([]);
    expect(f.rows.has(id)).toBe(false);
    expect(f.rows.get(sandboxOrphanDocumentId(id))).toEqual({ status: 'killed', resolvedAt: expect.any(Number) });
  });

  it('explicit retention preserves pending cleanup across generic account/workspace erasure', () => {
    expect(RETAINED_INDEFINITELY.some(p => p.collection === 'agentv3_sandbox_orphans')).toBe(true);
    expect(USER_SCOPED_COLLECTIONS.some(p => p.collection === 'agentv3_sandbox_orphans')).toBe(false);
    expect(WORKSPACE_SCOPED_COLLECTIONS.some(p => p.collection === 'agentv3_sandbox_orphans')).toBe(false);
  });

  it('mixed legacy/hash pages eventually migrate and reach every pending resource', async () => {
    const f = orphanFixture(); const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const id = `legacy-${i}`;
      f.rows.set(id, { sandboxId: id, workspaceId: 'private', status: 'pending' });
    }
    for (let i = 0; i < 15; i++) {
      for (const row of await f.store.listPendingOrphanAllocations(20)) seen.add(row.sandboxId);
    }
    expect(seen.size).toBe(60);
    expect(JSON.stringify([...f.rows])).not.toContain('private');
    expect([...f.rows.keys()].filter(id => id.startsWith('legacy-'))).toEqual([]);
  });

  it('reports unavailable storage instead of claiming an orphan was retained', async () => {
    const store = new SandboxStore(() => null);
    expect(await store.recordOrphanAllocation('machine-loser', 'losing-allocation')).toBe(false);
    expect(await store.listPendingOrphanAllocations()).toEqual([]);
  });
});
