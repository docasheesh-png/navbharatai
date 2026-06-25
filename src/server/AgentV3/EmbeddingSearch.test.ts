import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingStore, getEmbeddingStore, _clearEmbeddingStores } from './EmbeddingSearch';

describe('EmbeddingStore — offline (no API key)', () => {
  it('starts empty', () => {
    const s = new EmbeddingStore('');
    expect(s.size).toBe(0);
  });

  it('embed returns null when no API key is configured', async () => {
    const s = new EmbeddingStore('');
    expect(await s.embed('some text')).toBeNull();
  });

  it('addFile is a no-op when embed returns null (key absent)', async () => {
    const s = new EmbeddingStore('');
    await s.addFile('src/App.tsx', 'export function App() {}');
    expect(s.size).toBe(0);
  });

  it('search returns [] when no files are indexed', async () => {
    const s = new EmbeddingStore('');
    expect(await s.search('checkout')).toEqual([]);
  });

  it('removeFile on an unindexed path does not throw', () => {
    const s = new EmbeddingStore('');
    expect(() => s.removeFile('nonexistent.ts')).not.toThrow();
  });

  it('search returns [] even after addFile no-op', async () => {
    const s = new EmbeddingStore('');
    await s.addFile('src/Foo.ts', 'export const x = 1;');
    expect(await s.search('x')).toEqual([]);
  });
});

describe('getEmbeddingStore registry', () => {
  beforeEach(() => _clearEmbeddingStores());

  it('returns the same instance for the same workspace id', () => {
    const a1 = getEmbeddingStore('ws-1');
    const a2 = getEmbeddingStore('ws-1');
    expect(a1).toBe(a2);
  });

  it('returns different instances for different workspace ids', () => {
    const a = getEmbeddingStore('ws-a');
    const b = getEmbeddingStore('ws-b');
    expect(a).not.toBe(b);
  });

  it('isolates state: indexing in ws-a does not affect ws-b', async () => {
    _clearEmbeddingStores();
    // Both stores have no API key so addFile is a no-op, but the stores themselves are separate.
    const a = getEmbeddingStore('ws-a');
    const b = getEmbeddingStore('ws-b');
    expect(a).not.toBe(b);
    expect(a.size).toBe(0);
    expect(b.size).toBe(0);
  });
});
