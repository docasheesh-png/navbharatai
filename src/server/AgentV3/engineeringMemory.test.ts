import { describe, it, expect } from 'vitest';
import { findingsToDebt, engineeringMemoryDigest } from './engineeringMemory';
import { mergeDebt, prioritizeDebt } from '../AppMakerLab/intelligence/TechnicalDebtTracker';
import type { SecurityFinding } from './SecurityAnalysis';

const sec = (over: Partial<SecurityFinding>): SecurityFinding => ({
  file: 'src/a.ts', line: 1, severity: 'high', rule: 'hardcoded-secret', message: 'Hardcoded credential', ...over,
});

describe('findingsToDebt', () => {
  it('maps security findings into tech-debt IncomingFindings (category security, severity preserved)', () => {
    const out = findingsToDebt({ security: [sec({}), sec({ file: 'src/b.ts', severity: 'medium', message: 'Weak hash' })] });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ category: 'security', severity: 'high', file: 'src/a.ts' });
    expect(out[0].message).toContain('[hardcoded-secret]'); // rule appended for context
    expect(out[1]).toMatchObject({ severity: 'medium', file: 'src/b.ts' });
  });

  it('folds in already-normalized extra findings and drops empty-message ones', () => {
    const out = findingsToDebt({
      security: [sec({ message: '  ' })], // blank → dropped
      extra: [{ category: 'architecture', severity: 'low', file: 'src/x.ts', message: 'circular import' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: 'architecture', message: 'circular import' });
  });

  it('coerces an unknown severity to medium and tolerates missing file', () => {
    const out = findingsToDebt({ extra: [{ category: 'lint', severity: 'weird' as any, message: 'no-unused' }] });
    expect(out[0].severity).toBe('medium');
    expect(out[0].file).toBeUndefined();
  });

  it('is empty for no findings', () => {
    expect(findingsToDebt({})).toEqual([]);
    expect(findingsToDebt({ security: [], extra: [] })).toEqual([]);
  });

  it('feeds cleanly into the real tech-debt merge/prioritize pipeline', () => {
    const incoming = findingsToDebt({ security: [sec({ severity: 'high' }), sec({ file: 'src/b.ts', severity: 'medium', message: 'Weak hash' })] });
    const merged = mergeDebt([], incoming, '2026-07-14T00:00:00.000Z');
    const prioritized = prioritizeDebt(merged);
    expect(prioritized).toHaveLength(2);
    expect(prioritized[0].severity).toBe('high'); // higher severity first
  });
});

describe('engineeringMemoryDigest', () => {
  it('is empty when there is no debt', () => {
    expect(engineeringMemoryDigest([])).toBe('');
  });

  it('renders a compact prompt block of carried debt', () => {
    const debt = prioritizeDebt(mergeDebt([], findingsToDebt({ security: [sec({})] }), '2026-07-14T00:00:00.000Z'));
    const digest = engineeringMemoryDigest(debt);
    expect(digest).toContain('Engineering memory —');
    expect(digest).toContain('security');
    expect(digest).toContain('src/a.ts');
  });
});
