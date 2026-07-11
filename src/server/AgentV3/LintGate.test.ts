import { describe, it, expect } from 'vitest';
import { lintGateVerdict } from './LintGate';
import type { LintOutcome } from './lintRunner';

const eslint = (errorCount: number | null, issues: string[] = [], warningCount = 0): LintOutcome => ({
  tool: 'eslint', command: 'npx --no-install eslint . -f json', exitCode: errorCount ? 1 : 0,
  ok: errorCount === 0, errorCount, warningCount, firstIssues: issues, summary: 'eslint',
});
const prettier = (unformatted: number): LintOutcome => ({
  tool: 'prettier', command: 'npx prettier --check .', exitCode: unformatted ? 1 : 0,
  ok: unformatted === 0, errorCount: unformatted || 0, warningCount: 0, firstIssues: [], summary: 'prettier',
});

describe('lintGateVerdict', () => {
  it('blocks on ESLint errors and surfaces the concrete issues', () => {
    const v = lintGateVerdict([eslint(2, ['src/a.ts:3 no-undef — foo is not defined', 'src/b.ts:9 react-hooks/rules-of-hooks'])]);
    expect(v.blocked).toBe(true);
    expect(v.errorCount).toBe(2);
    expect(v.blockers).toHaveLength(2);
    expect(v.summary).toContain('2 ESLint errors');
  });

  it('does NOT block on ESLint warnings alone (style, not correctness)', () => {
    const v = lintGateVerdict([eslint(0, [], 5)]);
    expect(v.blocked).toBe(false);
    expect(v.errorCount).toBe(0);
  });

  it('does NOT block on Prettier formatting issues', () => {
    const v = lintGateVerdict([prettier(7)]);
    expect(v.blocked).toBe(false);
  });

  it('does NOT block when ESLint output was unparseable (errorCount null) — best-effort', () => {
    const v = lintGateVerdict([eslint(null, ['eslint: command not found'])]);
    expect(v.blocked).toBe(false);
    expect(v.errorCount).toBe(0);
  });

  it('sums ESLint errors across linters and clamps the blocker list', () => {
    const many = Array.from({ length: 15 }, (_, i) => `src/f${i}.ts:1 no-unused-vars`);
    const v = lintGateVerdict([eslint(15, many), prettier(3)]);
    expect(v.blocked).toBe(true);
    expect(v.errorCount).toBe(15);
    expect(v.blockers.length).toBeLessThanOrEqual(10);
  });

  it('is clean on an empty outcome list', () => {
    expect(lintGateVerdict([]).blocked).toBe(false);
  });
});
