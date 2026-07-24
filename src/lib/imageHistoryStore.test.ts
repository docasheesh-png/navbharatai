import { describe, it, expect } from 'vitest';
import { pruneHistory, MemoryImageHistoryStore, IMAGE_HISTORY_MAX, type ImageHistoryItem } from './imageHistoryStore';

const item = (id: string, ts: number): ImageHistoryItem => ({
  id, url: `data:image/png;base64,${id}`, prompt: `p-${id}`, type: 'App icon', style: 'minimal', size: 'square', timestamp: ts,
});

describe('pruneHistory (pure)', () => {
  it('sorts newest-first', () => {
    const out = pruneHistory([item('a', 100), item('c', 300), item('b', 200)]);
    expect(out.map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });
  it('caps to the max, keeping only the newest', () => {
    const many = Array.from({ length: IMAGE_HISTORY_MAX + 10 }, (_, i) => item(`i${i}`, i));
    const out = pruneHistory(many);
    expect(out.length).toBe(IMAGE_HISTORY_MAX);
    expect(out[0].timestamp).toBe(IMAGE_HISTORY_MAX + 9); // newest kept
    expect(out.some((i) => i.timestamp === 0)).toBe(false); // oldest dropped
  });
  it('respects a custom max and never returns a negative slice', () => {
    expect(pruneHistory([item('a', 1), item('b', 2)], 1).map((i) => i.id)).toEqual(['b']);
    expect(pruneHistory([item('a', 1)], 0)).toEqual([]);
  });
  it('does not mutate the input array', () => {
    const input = [item('a', 1), item('b', 2)];
    pruneHistory(input);
    expect(input.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('MemoryImageHistoryStore — the persistence contract (same behaviour the IndexedDB store must honour)', () => {
  it('saves and reloads items NEWEST-FIRST (survives a fresh getAll = "reload")', async () => {
    const store = new MemoryImageHistoryStore();
    await store.save(item('a', 100));
    await store.save(item('b', 300));
    await store.save(item('c', 200));
    expect((await store.getAll()).map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });
  it('bounds itself to IMAGE_HISTORY_MAX, dropping the oldest on save', async () => {
    const store = new MemoryImageHistoryStore();
    for (let i = 0; i < IMAGE_HISTORY_MAX + 5; i++) await store.save(item(`i${i}`, i));
    const all = await store.getAll();
    expect(all.length).toBe(IMAGE_HISTORY_MAX);
    expect(all[0].id).toBe(`i${IMAGE_HISTORY_MAX + 4}`); // newest
  });
  it('remove deletes one, clear empties everything', async () => {
    const store = new MemoryImageHistoryStore();
    await store.save(item('a', 1));
    await store.save(item('b', 2));
    await store.remove('a');
    expect((await store.getAll()).map((i) => i.id)).toEqual(['b']);
    await store.clear();
    expect(await store.getAll()).toEqual([]);
  });
  it('a re-saved id replaces (not duplicates) the item', async () => {
    const store = new MemoryImageHistoryStore();
    await store.save(item('a', 1));
    await store.save({ ...item('a', 5), prompt: 'updated' });
    const all = await store.getAll();
    expect(all.length).toBe(1);
    expect(all[0].prompt).toBe('updated');
  });
});
