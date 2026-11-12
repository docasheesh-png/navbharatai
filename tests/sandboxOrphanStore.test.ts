import { describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { SandboxStore } from '../src/server/AgentV3/SandboxStore';

function orphanFixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({ id, name }),
      where: (field: string, op: string, value: string) => {
        expect([name, field, op, value]).toEqual(['agentv3_sandbox_orphans', 'status', '==', 'pending']);
        let max = 50;
        const query = {
          limit: (n: number) => { max = n; return query; },
          get: async () => ({
            docs: [...rows.entries()]
              .filter(([, row]) => row.status === 'pending')
              .slice(0, max)
              .map(([id, row]) => ({ id, data: () => ({ ...row }) })),
          }),
        };
        return query;
      },
    }),
    runTransaction: vi.fn(async (run: (tx: object) => Promise<unknown>) => run({
      get: async (ref: { id: string }) => {
        const row = rows.get(ref.id);
        return { exists: !!row, data: () => row ? { ...row } : undefined };
      },
      set: (ref: { id: string }, fields: Record<string, unknown>, options?: { merge?: boolean }) => {
        rows.set(ref.id, options?.merge ? { ...(rows.get(ref.id) ?? {}), ...fields } : { ...fields });
      },
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
    expect(await f.store.recordOrphanAllocation('workspace-1', 'machine-loser', 'losing-allocation')).toBe(true);
    expect(await f.store.listPendingOrphanAllocations()).toEqual([{
      workspaceId: 'workspace-1',
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
    await f.store.recordOrphanAllocation('workspace-1', 'machine-loser', 'losing-allocation');
    await f.store.markOrphanAllocationHandled('machine-loser', 'killed');
    expect(await f.store.recordOrphanAllocation('workspace-2', 'machine-loser', 'retry')).toBe(true);
    expect(await f.store.listPendingOrphanAllocations()).toEqual([]);
    expect(f.rows.get('machine-loser')?.status).toBe('killed');
  });

  it('reports unavailable storage instead of claiming an orphan was retained', async () => {
    const store = new SandboxStore(() => null);
    expect(await store.recordOrphanAllocation('workspace-1', 'machine-loser', 'losing-allocation')).toBe(false);
    expect(await store.listPendingOrphanAllocations()).toEqual([]);
  });
});
