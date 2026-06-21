import { describe, it, expect } from 'vitest';
import { RepositoryIndex } from '../src/server/AppMakerLab/intelligence/RepositoryIndex';
import type { FileMetadata } from '../src/server/AppMakerLab/intelligence/RepositoryIndex';

function makeMeta(path: string, symbolNames: string[] = []): FileMetadata {
  return {
    path,
    tech: ['typescript'],
    dependencies: [],
    symbols: symbolNames.map(name => ({ type: 'function', name })),
    contentHash: 'abc123',
  };
}

describe('RepositoryIndex', () => {
  it('starts empty', async () => {
    const idx = new RepositoryIndex();
    expect(await idx.getAll()).toHaveLength(0);
  });

  it('stores and retrieves a file by path', async () => {
    const idx = new RepositoryIndex();
    await idx.update('src/App.tsx', makeMeta('src/App.tsx'));
    const meta = await idx.get('src/App.tsx');
    expect(meta?.path).toBe('src/App.tsx');
  });

  it('returns undefined for unknown path', async () => {
    const idx = new RepositoryIndex();
    expect(await idx.get('missing.ts')).toBeUndefined();
  });

  it('indexes symbols for lookup', async () => {
    const idx = new RepositoryIndex();
    await idx.update('src/utils.ts', makeMeta('src/utils.ts', ['formatDate', 'parseISO']));
    expect(idx.getSymbolDefinition('formatDate')).toBe('src/utils.ts');
  });

  it('prune removes files not in existingPaths', async () => {
    const idx = new RepositoryIndex();
    await idx.update('src/a.ts', makeMeta('src/a.ts'));
    await idx.update('src/b.ts', makeMeta('src/b.ts'));
    await idx.prune(new Set(['src/a.ts']));
    expect(await idx.get('src/b.ts')).toBeUndefined();
    expect(await idx.get('src/a.ts')).toBeDefined();
  });
});
