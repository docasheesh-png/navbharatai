import { describe, it, expect } from 'vitest';
import { DependencyResolver } from '../src/server/BuildEngine/DependencyResolver';
import type { Feature } from '../src/server/BuildEngine/types';

function feature(id: string, deps: string[] = []): Feature {
  return { id, dependencies: deps, capabilities: [], components: [], logicHandlers: [] };
}

describe('DependencyResolver.resolve', () => {
  const resolver = new DependencyResolver();

  it('returns an empty array for no features', () => {
    expect(resolver.resolve([])).toHaveLength(0);
  });

  it('returns the single feature unchanged', () => {
    const f = feature('auth');
    expect(resolver.resolve([f])).toEqual([f]);
  });

  it('deduplicates features with the same id', () => {
    const f1 = feature('ui-atoms');
    const f2 = feature('ui-atoms');
    const result = resolver.resolve([f1, f2]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ui-atoms');
  });

  it('preserves all distinct features', () => {
    const features = [feature('auth'), feature('billing'), feature('dashboard')];
    const result = resolver.resolve(features);
    expect(result).toHaveLength(3);
    const ids = result.map(f => f.id);
    expect(ids).toContain('auth');
    expect(ids).toContain('billing');
    expect(ids).toContain('dashboard');
  });

  it('keeps the first occurrence when duplicates appear', () => {
    const original = feature('auth');
    const duplicate = { ...feature('auth'), capabilities: ['extra'] };
    const result = resolver.resolve([original, duplicate]);
    expect(result[0]).toBe(original);
  });
});
