import { describe, it, expect } from 'vitest';
import { analyzeMaintainability, maintainabilitySummary } from './maintainabilityAnalysis';

const file = (path: string, lines: number) => ({ path, content: Array.from({ length: lines }, (_, i) => `line ${i}`).join('\n') });

describe('analyzeMaintainability', () => {
  it('flags a source file over 1500 lines as a medium oversized-file with its exact line count', () => {
    const issues = analyzeMaintainability([file('src/App.tsx', 1800)]);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('oversized-file');
    expect(issues[0].severity).toBe('medium');
    expect(issues[0].path).toBe('src/App.tsx');
    expect(issues[0].detail).toContain('1800 lines');
  });

  it('flags a file between 800 and 1500 lines as low severity', () => {
    const [issue] = analyzeMaintainability([file('src/Big.tsx', 1000)]);
    expect(issue.severity).toBe('low');
  });

  it('does NOT flag a comfortably-sized file (under the 800-line floor)', () => {
    expect(analyzeMaintainability([file('src/Fine.tsx', 400)])).toEqual([]);
  });

  it('excludes test/spec and .d.ts files even when large', () => {
    expect(analyzeMaintainability([
      file('src/App.test.tsx', 2000),
      file('src/App.spec.ts', 2000),
      file('src/types.d.ts', 2000),
    ])).toEqual([]);
  });

  it('only judges real source modules (skips json/css/md/etc.)', () => {
    expect(analyzeMaintainability([
      file('data.json', 2000),
      file('styles.css', 2000),
      file('README.md', 2000),
    ])).toEqual([]);
  });

  it('does not add a phantom line for a trailing newline (boundary at exactly 800)', () => {
    // 799 real lines + trailing newline → 799, under the floor → not flagged.
    const content = Array.from({ length: 799 }, (_, i) => `l${i}`).join('\n') + '\n';
    expect(analyzeMaintainability([{ path: 'src/X.ts', content }])).toEqual([]);
  });

  it('sorts medium (bigger) before low and caps at 20 issues', () => {
    const many = Array.from({ length: 25 }, (_, i) => file(`src/f${i}.tsx`, 900)); // all low
    const withOneMedium = [file('src/Huge.tsx', 2000), ...many];
    const issues = analyzeMaintainability(withOneMedium);
    expect(issues).toHaveLength(20);
    expect(issues[0].severity).toBe('medium'); // the huge file ranks first
  });

  it('tolerates malformed entries without throwing', () => {
    // @ts-expect-error — deliberately malformed input
    expect(analyzeMaintainability([{ path: 123, content: null }, null])).toEqual([]);
  });
});

describe('maintainabilitySummary', () => {
  it('reports the clean line when there is nothing oversized', () => {
    expect(maintainabilitySummary([])).toContain('No oversized files');
  });

  it('lists the oversized files with their severity', () => {
    const out = maintainabilitySummary(analyzeMaintainability([file('src/App.tsx', 1800)]));
    expect(out).toContain('1 oversized file(s)');
    expect(out).toContain('[medium]');
    expect(out).toContain('src/App.tsx');
  });
});
