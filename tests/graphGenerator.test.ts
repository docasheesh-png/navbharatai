import { describe, it, expect } from 'vitest';
import { GraphGenerator } from '../src/server/AppMakerLab/intelligence/GraphGenerator';

function fileEntry(path: string, dependencies: string[] = []) {
  return { path, dependencies };
}

describe('GraphGenerator.generate', () => {
  const gen = new GraphGenerator();

  it('returns nodes for each file in the index', () => {
    const result = gen.generate([fileEntry('/src/App.ts'), fileEntry('/src/utils.ts')]);
    expect(result.nodes).toContain('/src/App.ts');
    expect(result.nodes).toContain('/src/utils.ts');
  });

  it('returns empty edges when there are no dependencies', () => {
    const result = gen.generate([fileEntry('/src/a.ts'), fileEntry('/src/b.ts')]);
    expect(result.edges).toHaveLength(0);
  });

  it('returns empty nodes and edges for empty index', () => {
    const result = gen.generate([]);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('non-resolvable (external package) deps produce no edges', () => {
    const result = gen.generate([fileEntry('/src/App.ts', ['react', 'axios'])]);
    expect(result.edges).toHaveLength(0);
  });

  it('relative import that does not match any path produces no edge', () => {
    const result = gen.generate([fileEntry('/src/a.ts', ['./missing'])]);
    expect(result.edges).toHaveLength(0);
  });
});
