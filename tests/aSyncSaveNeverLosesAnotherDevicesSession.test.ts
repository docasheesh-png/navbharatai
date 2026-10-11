/**
 * Audit 2026-10-11, D7: two devices saving together could drop each other's sessions.
 *
 * `POST /api/sync` read the stored workspace, merged, and wrote back with plain reads and writes. Each device
 * merged against the state BEFORE the other's write, so the second write erased the first device's new
 * session. A save is now one transaction — which Firestore retries when a document it read changed before it
 * committed — and these tests run that exact retry rule against a store double.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { saveWorkspaceTx, readWorkspaceTx, type SyncTx } from '../src/server/project/syncTransaction';
import { chunkDocId } from '../src/server/project/WorkspaceStore';

/** A tiny optimistic-concurrency store: a transaction that read a document changed since is retried. */
function store() {
  const docs = new Map<string, { v: number; data: Record<string, unknown> }>();
  let tick = 0;
  const pause = () => new Promise<void>((r) => setTimeout(r, 1));
  async function runTransaction<T>(fn: (tx: SyncTx<string>) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const seen = new Map<string, number>();
      const writes: Array<() => void> = [];
      const read = async (id: string) => { await pause(); const d = docs.get(id); seen.set(id, d?.v ?? 0); return { exists: !!d, data: () => d?.data }; };
      const tx: SyncTx<string> = {
        get: read,
        getAll: (...ids: string[]) => Promise.all(ids.map(read)),
        set: (id, data) => { writes.push(() => docs.set(id, { v: ++tick, data })); },
        delete: (id) => { writes.push(() => docs.delete(id)); },
      };
      const result = await fn(tx);
      await pause();
      if ([...seen].every(([id, v]) => (docs.get(id)?.v ?? 0) === v)) { writes.forEach((w) => w()); return result; }
    }
    throw new Error('too much contention');
  }
  return { docs, runTransaction };
}

const ref = (id: string) => id;

describe('a sync save is one transaction', () => {
  it('two devices saving at the same moment both keep their new session', async () => {
    const s = store();
    await s.runTransaction((tx) => saveWorkspaceTx(tx, ref, 'u1', { sessions: [{ id: 'old', lastUpdated: 1 }], lastApp: '' }));
    await Promise.all([
      s.runTransaction((tx) => saveWorkspaceTx(tx, ref, 'u1', { sessions: [{ id: 'phone', lastUpdated: 5 }], lastApp: '' })),
      s.runTransaction((tx) => saveWorkspaceTx(tx, ref, 'u1', { sessions: [{ id: 'laptop', lastUpdated: 6 }], lastApp: '' })),
    ]);
    const out = await s.runTransaction((tx) => readWorkspaceTx(tx, ref, 'u1'));
    expect(out.payload.sessions.map((x) => x.id).sort()).toEqual(['laptop', 'old', 'phone']);
  });

  it('a workspace that shrinks drops its surplus chunks in the same commit', async () => {
    const s = store();
    const big = { id: 'big', lastUpdated: 1, blob: 'x'.repeat(2_000_000) };
    await s.runTransaction((tx) => saveWorkspaceTx(tx, ref, 'u2', { sessions: [big], lastApp: '' }));
    expect(s.docs.has(chunkDocId('u2', 1))).toBe(true);
    await s.runTransaction((tx) => saveWorkspaceTx(tx, ref, 'u2', { sessions: [{ id: 'big', lastUpdated: 2 }], lastApp: '' }));
    expect(s.docs.has(chunkDocId('u2', 1))).toBe(false);
    const out = await s.runTransaction((tx) => readWorkspaceTx(tx, ref, 'u2'));
    expect(out.payload.sessions).toEqual([{ id: 'big', lastUpdated: 2 }]);
  });

  it('too large is refused with nothing written', async () => {
    const s = store();
    const out = await s.runTransaction((tx) => saveWorkspaceTx(tx, ref, 'u3', { sessions: [{ id: 'huge', blob: 'y'.repeat(8_100_000) }], lastApp: '' }));
    expect(out.ok).toBe(false);
    expect(s.docs.size).toBe(0);
  });

  it('the route saves and loads only through a transaction', () => {
    const src = readFileSync('src/server/routes/sync.ts', 'utf8');
    expect(src).toMatch(/db\.runTransaction\(\(tx: SyncTx<unknown>\) => saveWorkspaceTx\(/);
    expect(src).toMatch(/db\.runTransaction\(\(tx: SyncTx<unknown>\) => readWorkspaceTx\(tx, ref, userId\), \{ readOnly: true \}\)/);
    expect(src).not.toMatch(/\b(setDoc|deleteDoc|getDoc)\(/);
  });
});
