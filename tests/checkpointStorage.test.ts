import { describe, it, expect } from 'vitest';
import { CheckpointStorage, checkpointStorageDocId, fitsFirestoreDoc } from '../src/server/AppMakerLab/checkpoint/CheckpointStorage';

/** P-DATA.2 — durable checkpoint storage: pure helpers + local round-trip (Firestore skipped in VITEST). */

describe('checkpointStorageDocId', () => {
  it('is deterministic, slash-free and bounded', () => {
    const a = checkpointStorageDocId('plan/123:abc');
    expect(a).toBe(checkpointStorageDocId('plan/123:abc'));
    expect(a).not.toContain('/');
    expect(a.length).toBeLessThanOrEqual(1500);
  });
});

describe('fitsFirestoreDoc', () => {
  it('accepts small content, rejects > ~900KB', () => {
    expect(fitsFirestoreDoc('{"a":1}')).toBe(true);
    expect(fitsFirestoreDoc('x'.repeat(900 * 1024 + 1))).toBe(false);
  });
});

describe('CheckpointStorage local round-trip (no Firestore under VITEST)', () => {
  it('saves, loads, lists and deletes a checkpoint on the local cache', async () => {
    const store = new CheckpointStorage();
    const id = `test_cp_${Math.abs(((): number => { let h = 0; for (const c of 'cp') h = (h * 31 + c.charCodeAt(0)) | 0; return h; })())}`;
    const cp = { id, label: 'unit', createdAt: new Date(0).toISOString(), files: { 'a.ts': 'x' } } as any;
    await store.save(id, cp);
    const loaded = await store.load(id);
    expect((loaded as any).id).toBe(id);
    const list = await store.list();
    expect(list.some((c: any) => c.id === id)).toBe(true);
    await store.delete(id);
    await expect(store.load(id)).rejects.toBeTruthy();
  });
});
