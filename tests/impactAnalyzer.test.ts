import { describe, it, expect } from 'vitest';
import { ImpactAnalyzer } from '../src/server/AppMakerLab/intelligence/ImpactAnalyzer';

function graph(edges: { from: string; to: string }[]) {
  return { edges };
}

describe('ImpactAnalyzer.analyze', () => {
  const ia = new ImpactAnalyzer();

  it('includes the seed file itself in impactedFiles', () => {
    const r = ia.analyze(['src/utils.ts'], graph([]));
    expect(r.impactedFiles).toContain('src/utils.ts');
  });

  it('traverses reverse edges (dependents) via BFS', () => {
    // A imports B — changing B impacts A too
    const r = ia.analyze(['src/B.ts'], graph([{ from: 'src/A.ts', to: 'src/B.ts' }]));
    expect(r.impactedFiles).toContain('src/A.ts');
  });

  it('calculates maxDependencyDepth correctly', () => {
    // C → B → A (changing A ripples through B then C)
    const g = graph([
      { from: 'B.ts', to: 'A.ts' },
      { from: 'C.ts', to: 'B.ts' },
    ]);
    const r = ia.analyze(['A.ts'], g);
    expect(r.maxDependencyDepth).toBe(2);
  });

  it('detects entry points by name (App, index, main)', () => {
    const r = ia.analyze(['src/App.tsx'], graph([]));
    expect(r.affectedEntryPoints).toContain('src/App.tsx');
  });

  it('does not mark a non-entry file as an entry point', () => {
    const r = ia.analyze(['src/utils.ts'], graph([]));
    expect(r.affectedEntryPoints).toHaveLength(0);
  });

  it('riskScore formula: (files * 5) + (depth * 15) + (entryPoints * 20)', () => {
    // 1 file, depth 0, no entry point → (1*5) + (0*15) + (0*20) = 5
    const r = ia.analyze(['helper.ts'], graph([]));
    expect(r.riskScore).toBe(5);
  });

  it('does not revisit already-impacted files (cycle-safe)', () => {
    const g = graph([
      { from: 'A.ts', to: 'B.ts' },
      { from: 'B.ts', to: 'A.ts' },
    ]);
    expect(() => ia.analyze(['A.ts'], g)).not.toThrow();
  });
});
