import { describe, it, expect } from 'vitest';
import {
  analyzeTestCoverage,
  testCoverageSummary,
  type TestCoverageReport,
} from './TestCoverageAnalysis';
import type { ProjectGraph } from './WorkspaceMemory';

function graph(partial: Partial<ProjectGraph>): ProjectGraph {
  return {
    files: [],
    symbols: [],
    components: [],
    routes: [],
    imports: {},
    dependencies: [],
    ...partial,
  };
}

const has = (r: TestCoverageReport, level: 'high' | 'medium' | 'low') =>
  r.findings.some((f) => f.level === level);

describe('analyzeTestCoverage', () => {
  it('returns no findings for an empty graph', () => {
    const r = analyzeTestCoverage(graph({}));
    expect(r.findings).toHaveLength(0);
    expect(r.sourceFiles).toBe(0);
    expect(r.coverageRatio).toBe(0);
  });

  it('flags HIGH when there are source modules but zero tests', () => {
    const r = analyzeTestCoverage(graph({ files: ['src/A.tsx', 'src/B.tsx', 'src/C.ts'] }));
    expect(r.testFiles).toBe(0);
    expect(r.sourceFiles).toBe(3);
    expect(has(r, 'high')).toBe(true);
  });

  it('credits a co-located test file as coverage', () => {
    const r = analyzeTestCoverage(graph({ files: ['src/A.tsx', 'src/A.test.tsx'] }));
    expect(r.uncoveredFiles).not.toContain('src/A.tsx');
    expect(r.coverageRatio).toBe(1);
    expect(r.findings).toHaveLength(0);
  });

  it('credits an import from a test file as coverage (different base names)', () => {
    const r = analyzeTestCoverage(
      graph({
        files: ['src/math.ts', 'src/calc.test.ts'],
        imports: { 'src/calc.test.ts': ['./math'] },
      }),
    );
    expect(r.uncoveredFiles).toHaveLength(0);
    expect(r.coverageRatio).toBe(1);
  });

  it('flags MEDIUM for an untested component while crediting a tested one', () => {
    const r = analyzeTestCoverage(
      graph({
        files: ['src/Button.tsx', 'src/Card.tsx', 'src/Button.test.tsx'],
        symbols: [
          { name: 'Button', kind: 'component', file: 'src/Button.tsx' },
          { name: 'Card', kind: 'component', file: 'src/Card.tsx' },
        ],
      }),
    );
    expect(r.untestedComponents).toContain('Card');
    expect(r.untestedComponents).not.toContain('Button');
    expect(has(r, 'medium')).toBe(true);
    expect(has(r, 'high')).toBe(false); // a test file exists, so not "no tests at all"
  });

  it('excludes entrypoints, config and type-declaration files from source count', () => {
    const r = analyzeTestCoverage(
      graph({ files: ['src/main.tsx', 'vite.config.ts', 'src/types.d.ts', 'src/App.tsx'] }),
    );
    expect(r.sourceFiles).toBe(1); // only App.tsx is a testable module
  });

  it('reports no gaps when every module is tested', () => {
    const r = analyzeTestCoverage(
      graph({ files: ['src/A.ts', 'src/B.ts', 'src/A.test.ts', 'src/B.test.ts'] }),
    );
    expect(r.findings).toHaveLength(0);
    expect(r.coverageRatio).toBe(1);
  });

  it('flags LOW when coverage is thin across several modules', () => {
    const r = analyzeTestCoverage(
      graph({
        files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/a.test.ts'],
      }),
    );
    expect(r.sourceFiles).toBe(5);
    expect(r.coverageRatio).toBeLessThan(0.5);
    expect(has(r, 'low')).toBe(true);
  });
});

describe('testCoverageSummary', () => {
  it('renders an honest pass line when there are no gaps', () => {
    const r = analyzeTestCoverage(graph({ files: ['src/A.ts', 'src/A.test.ts'] }));
    expect(testCoverageSummary(r)).toContain('✓');
    expect(testCoverageSummary(r)).toContain('Test coverage');
  });

  it('lists the gaps, highest severity first', () => {
    const r = analyzeTestCoverage(graph({ files: ['src/A.tsx', 'src/B.tsx', 'src/C.ts'] }));
    const out = testCoverageSummary(r);
    expect(out).toContain('Test coverage');
    expect(out).toContain('⚠');
  });

  it('handles the no-modules-yet case', () => {
    expect(testCoverageSummary(analyzeTestCoverage(graph({})))).toContain('no source modules');
  });
});
