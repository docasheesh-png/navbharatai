import { describe, it, expect } from 'vitest';
import { PatchAggregator } from '../src/server/AppMakerLab/generator/PatchAggregator';

describe('PatchAggregator', () => {
  it('starts with an empty patch list', () => {
    const agg = new PatchAggregator();
    expect(agg.getPatches()).toHaveLength(0);
  });

  it('stores added patches and returns them', () => {
    const agg = new PatchAggregator();
    agg.addPatches([{ path: 'src/App.tsx', content: '<App/>' }]);
    const patches = agg.getPatches();
    expect(patches).toHaveLength(1);
    expect(patches[0]).toEqual({ path: 'src/App.tsx', content: '<App/>' });
  });

  it('returns patches in deterministic alphabetical order by path', () => {
    const agg = new PatchAggregator();
    agg.addPatches([
      { path: 'src/z.ts', content: 'z' },
      { path: 'src/a.ts', content: 'a' },
      { path: 'package.json', content: '{}' },
    ]);
    const paths = agg.getPatches().map(p => p.path);
    expect(paths).toEqual(['package.json', 'src/a.ts', 'src/z.ts']);
  });

  it('later addPatches call overwrites earlier content for the same path', () => {
    const agg = new PatchAggregator();
    agg.addPatches([{ path: 'src/App.tsx', content: 'v1' }]);
    agg.addPatches([{ path: 'src/App.tsx', content: 'v2' }]);
    const patches = agg.getPatches();
    expect(patches).toHaveLength(1);
    expect(patches[0].content).toBe('v2');
  });

  it('accumulates patches across multiple addPatches calls', () => {
    const agg = new PatchAggregator();
    agg.addPatches([{ path: 'src/a.ts', content: 'a' }]);
    agg.addPatches([{ path: 'src/b.ts', content: 'b' }]);
    expect(agg.getPatches()).toHaveLength(2);
  });

  it('handles an empty addPatches call without error', () => {
    const agg = new PatchAggregator();
    agg.addPatches([]);
    expect(agg.getPatches()).toHaveLength(0);
  });
});
