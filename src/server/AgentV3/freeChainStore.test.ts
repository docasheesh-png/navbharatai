import { describe, it, expect, afterEach } from 'vitest';
import { setServerDb } from '../lib/serverDb';
import { firestoreFreeChainStore, FREE_CHAIN_COLLECTION } from './freeChainStore';

function fakeDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: rows.has(`${name}/${id}`), data: () => rows.get(`${name}/${id}`) }),
        set: async (v: Record<string, unknown>) => { rows.set(`${name}/${id}`, v); },
        delete: async () => { rows.delete(`${name}/${id}`); },
      }),
    }),
  };
  return { rows, db };
}

afterEach(() => setServerDb(null));

describe('firestoreFreeChainStore (Q-130)', () => {
  it('is null without a database, so the caller keeps its memory-only count', () => {
    setServerDb(null);
    expect(firestoreFreeChainStore()).toBeNull();
  });

  it('round-trips one record per workspace, and a removed chain reads as none', async () => {
    const { rows, db } = fakeDb();
    setServerDb(db as never);
    const store = firestoreFreeChainStore()!;
    await store.set('ws/1', { spentMs: 1500_000, touchedAt: 42 });
    expect(rows.has(`${FREE_CHAIN_COLLECTION}/ws%2F1`)).toBe(true);
    expect(await store.get('ws/1')).toEqual({ spentMs: 1500_000, touchedAt: 42 });
    await store.remove('ws/1');
    expect(await store.get('ws/1')).toBeNull();
  });

  it('a malformed record reads as none, never as a number it is not', async () => {
    const { rows, db } = fakeDb();
    setServerDb(db as never);
    rows.set(`${FREE_CHAIN_COLLECTION}/ws`, { spentMs: 'lots', touchedAt: 1 });
    expect(await firestoreFreeChainStore()!.get('ws')).toBeNull();
  });
});
