import { describe, it, expect } from 'vitest';
import { ImpactAnalyzer } from '../src/server/AppMakerLab/intelligence/ImpactAnalyzer';

function graph(edges: { from: string; to: string }[]) {
  return { edges };
}

describe('ImpactAnalyzer.analyze', () => {
  const analyzer = new ImpactAnalyzer();

  it('returns the seed files in impactedFiles', () => {
    const result = analyzer.analyze(['src/utils.ts'], graph([]));
    expect(result.impactedFiles).toContain('src/utils.ts');
  });

  it('follows graph edges to discover dependent files', () => {
    const g = graph([{ from: 'src/service.ts', to: 'src/utils.ts' }]);
    const result = analyzer.analyze(['src/utils.ts'], g);
    expect(result.impactedFiles).toContain('src/service.ts');
  });

  it('maxDependencyDepth is 0 when no edges exist', () => {
    const result = analyzer.analyze(['src/a.ts'], graph([]));
    expect(result.maxDependencyDepth).toBe(0);
  });

  it('maxDependencyDepth increases with graph depth', () => {
    const g = graph([
      { from: 'src/b.ts', to: 'src/a.ts' },
      { from: 'src/c.ts', to: 'src/b.ts' },
    ]);
    const result = analyzer.analyze(['src/a.ts'], g);
    expect(result.maxDependencyDepth).toBeGreaterThanOrEqual(2);
  });

  it('identifies entry points containing "index"', () => {
    const result = analyzer.analyze(['src/index.ts'], graph([]));
    expect(result.affectedEntryPoints).toContain('src/index.ts');
  });

  it('non-entry-point files are not added to affectedEntryPoints', () => {
    const result = analyzer.analyze(['src/utils.ts'], graph([]));
    expect(result.affectedEntryPoints).not.toContain('src/utils.ts');
  });

  it('riskScore is higher when more files are impacted', () => {
    const g = graph([{ from: 'src/b.ts', to: 'src/a.ts' }]);
    const single = analyzer.analyze(['src/other.ts'], graph([]));
    const multi = analyzer.analyze(['src/a.ts'], g);
    expect(multi.riskScore).toBeGreaterThan(single.riskScore);
  });
});
