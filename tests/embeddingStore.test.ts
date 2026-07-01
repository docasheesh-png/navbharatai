import { describe, it, expect } from 'vitest';
import { embeddingDocId, hashContent, needsReembed, saveEmbedding, loadEmbeddings, removeEmbedding } from '../src/server/AgentV3/EmbeddingStore';

/** P-DATA.3 — durable embeddings: pure hash/dedup helpers + best-effort no-throw under VITEST. */

describe('embeddingDocId', () => {
  it('is deterministic, slash-free, bounded', () => {
    const id = embeddingDocId('src/a/b.ts');
    expect(id).toBe(embeddingDocId('src/a/b.ts'));
    expect(id).not.toContain('/');
    expect(id.length).toBeLessThanOrEqual(1500);
  });
});

describe('hashContent', () => {
  it('is deterministic and content-sensitive', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
    expect(hashContent('abc')).not.toBe(hashContent('abd'));
    expect(hashContent('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('needsReembed', () => {
  it('re-embeds only when the hash is missing or changed', () => {
    expect(needsReembed(undefined, 'h1')).toBe(true);
    expect(needsReembed('h1', 'h2')).toBe(true);
    expect(needsReembed('h1', 'h1')).toBe(false);
  });
});

describe('store (best-effort, no Firestore under VITEST)', () => {
  it('save/load/remove never throw and load returns []', async () => {
    await expect(saveEmbedding('ws-1', { path: 'a.ts', hash: 'h', embedding: [0.1, 0.2] })).resolves.toBeUndefined();
    await expect(saveEmbedding('ws-1', { path: '', hash: 'h', embedding: [] })).resolves.toBeUndefined();
    await expect(removeEmbedding('ws-1', 'a.ts')).resolves.toBeUndefined();
    await expect(loadEmbeddings('ws-1')).resolves.toEqual([]);
    await expect(loadEmbeddings('')).resolves.toEqual([]);
  });
});
