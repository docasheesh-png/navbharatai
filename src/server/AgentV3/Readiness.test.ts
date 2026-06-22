import { describe, it, expect } from 'vitest';
import { assessReadiness, readinessVerdict } from './Readiness';
import type { ArchitectureReport } from './ArchitectureAnalysis';
import type { SecurityFinding } from './SecurityAnalysis';

const cleanArch: ArchitectureReport = {
  fileCount: 5, edgeCount: 6, cycles: [], unresolvedImports: [], layeringViolations: [],
};

describe('assessReadiness', () => {
  it('scores a clean project 100 and READY', () => {
    const r = assessReadiness(cleanArch, []);
    expect(r.score).toBe(100);
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('an unresolved import is a hard blocker (not ready)', () => {
    const r = assessReadiness({ ...cleanArch, unresolvedImports: ['a.ts -> ./missing'] }, []);
    expect(r.ready).toBe(false);
    expect(r.score).toBeLessThan(100);
    expect(r.blockers.join(' ')).toContain('unresolved');
  });

  it('a high-severity security finding blocks readiness', () => {
    const finding: SecurityFinding = { file: 'a.ts', line: 1, severity: 'high', rule: 'hardcoded-secret', message: 'x' };
    const r = assessReadiness(cleanArch, [finding]);
    expect(r.ready).toBe(false);
    expect(r.blockers.join(' ')).toContain('high-severity');
  });

  it('cycles and low/medium issues lower the score but do not block', () => {
    const r = assessReadiness(
      { ...cleanArch, cycles: [['a', 'b', 'a']] },
      [{ file: 'a.ts', line: 1, severity: 'low', rule: 'insecure-http', message: 'x' }],
    );
    expect(r.ready).toBe(true);
    expect(r.score).toBeLessThan(100);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('is deterministic and clamps to 0..100', () => {
    const manyBlockers = { ...cleanArch, unresolvedImports: Array(10).fill('a -> b') };
    const r1 = assessReadiness(manyBlockers, []);
    const r2 = assessReadiness(manyBlockers, []);
    expect(r1.score).toBe(r2.score);
    expect(r1.score).toBeGreaterThanOrEqual(0);
  });
});

describe('readinessVerdict', () => {
  it('states READY or NOT READY clearly', () => {
    expect(readinessVerdict(assessReadiness(cleanArch, []))).toContain('READY');
    const notReady = readinessVerdict(assessReadiness({ ...cleanArch, unresolvedImports: ['x -> y'] }, []));
    expect(notReady).toContain('NOT READY');
    expect(notReady).toContain('Must fix');
  });
});
