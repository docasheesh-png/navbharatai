import { describe, it, expect } from 'vitest';
import { DependencyResolver } from '../src/server/BuildEngine/DependencyResolver';
import type { Feature } from '../src/server/BuildEngine/types';

function makeFeature(id: string, dependencies: string[] = []): Feature {
  return { id, dependencies, capabilities: [], components: [], logicHandlers: [] };
}

describe('DependencyResolver', () => {
  it('returns empty array for empty input', () => {
    const resolver = new DependencyResolver();
    expect(resolver.resolve([])).toEqual([]);
  });

  it('returns the single feature when no dependencies', () => {
    const resolver = new DependencyResolver();
    const result = resolver.resolve([makeFeature('auth')]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('auth');
  });

  it('deduplicates features with the same id', () => {
    const resolver = new DependencyResolver();
    const result = resolver.resolve([makeFeature('auth'), makeFeature('auth')]);
    expect(result).toHaveLength(1);
  });

  it('resolves multiple distinct features', () => {
    const resolver = new DependencyResolver();
    const result = resolver.resolve([makeFeature('auth'), makeFeature('billing')]);
    expect(result).toHaveLength(2);
  });
});
