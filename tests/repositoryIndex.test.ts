import { describe, it, expect } from 'vitest';
import { RepositoryIndex } from '../src/server/AppMakerLab/intelligence/RepositoryIndex';
import type { FileMetadata } from '../src/server/AppMakerLab/intelligence/RepositoryIndex';

function meta(filePath: string, symbols: string[] = []): FileMetadata {
  return { path: filePath, tech: ['typescript'], dependencies: [], symbols: symbols.map(n => ({ type: 'component', name: n })), contentHash: 'abc' };
}

describe('RepositoryIndex', () => {
  it('get() returns undefined for an unknown path', async () => {
    const idx = new RepositoryIndex();
    expect(await idx.get('unknown.ts')).toBeUndefined();
  });

  it('update() stores metadata retrievable by get()', async () => {
    const idx = new RepositoryIndex();
    await idx.update('src/App.tsx', meta('src/App.tsx'));
    const result = await idx.get('src/App.tsx');
    expect(result?.path).toBe('src/App.tsx');
  });

  it('getAll() returns all indexed entries', async () => {
    const idx = new RepositoryIndex();
    await idx.update('src/A.ts', meta('src/A.ts'));
    await idx.update('src/B.ts', meta('src/B.ts'));
    const all = await idx.getAll();
    expect(all).toHaveLength(2);
  });

  it('getAll() returns empty array on a fresh index', async () => {
    const idx = new RepositoryIndex();
    expect(await idx.getAll()).toHaveLength(0);
  });

  it('prune() removes paths not in the existingPaths set', async () => {
    const idx = new RepositoryIndex();
    await idx.update('src/A.ts', meta('src/A.ts'));
    await idx.update('src/B.ts', meta('src/B.ts'));
    await idx.prune(new Set(['src/A.ts']));
    expect(await idx.get('src/B.ts')).toBeUndefined();
    expect(await idx.get('src/A.ts')).toBeDefined();
  });

  it('update() overwrites existing metadata for the same path', async () => {
    const idx = new RepositoryIndex();
    await idx.update('src/App.tsx', meta('src/App.tsx', ['OldApp']));
    await idx.update('src/App.tsx', meta('src/App.tsx', ['NewApp']));
    const result = await idx.get('src/App.tsx');
    expect(result?.symbols[0].name).toBe('NewApp');
  });
});
