import { describe, it, expect } from 'vitest';
import { detectLinters, parseLintOutcome, type LintPlan } from './lintRunner';

// GA-12: ESLint/Prettier detection + result parsing. Both pure.

describe('detectLinters', () => {
  it('detects ESLint by config file (JSON format for parseability)', () => {
    const plans = detectLinters(['.eslintrc.json', 'src/App.tsx']);
    expect(plans.map(p => p.tool)).toEqual(['eslint']);
    expect(plans[0].command).toContain('eslint . -f json');
  });

  it('detects ESLint (flat config) and Prettier by dependency', () => {
    const pkg = JSON.stringify({ devDependencies: { eslint: '^9', prettier: '^3' } });
    const plans = detectLinters(['eslint.config.js'], pkg);
    expect(plans.map(p => p.tool).sort()).toEqual(['eslint', 'prettier']);
  });

  it('returns [] when neither is configured', () => {
    expect(detectLinters(['index.html', 'style.css'])).toEqual([]);
  });
});

const eslintPlan: LintPlan = { tool: 'eslint', command: 'x', reason: 'r' };
const prettierPlan: LintPlan = { tool: 'prettier', command: 'x', reason: 'r' };

describe('parseLintOutcome — eslint', () => {
  it('parses the JSON report: counts errors/warnings and lists error issues', () => {
    const json = JSON.stringify([
      { filePath: '/w/src/App.tsx', messages: [
        { ruleId: 'no-unused-vars', severity: 2, message: "'x' is defined but never used.", line: 3 },
        { ruleId: 'react-hooks/exhaustive-deps', severity: 1, message: 'missing dep', line: 9 },
      ] },
    ]);
    const o = parseLintOutcome(eslintPlan, 1, json, '');
    expect(o.ok).toBe(false);
    expect(o.errorCount).toBe(1);
    expect(o.warningCount).toBe(1);
    expect(o.firstIssues[0]).toContain('no-unused-vars');
  });

  it('is OK when there are zero errors (warnings do not fail)', () => {
    const json = JSON.stringify([{ filePath: '/w/a.ts', messages: [{ ruleId: 'x', severity: 1, message: 'w', line: 1 }] }]);
    const o = parseLintOutcome(eslintPlan, 0, json, '');
    expect(o.ok).toBe(true);
    expect(o.errorCount).toBe(0);
    expect(o.warningCount).toBe(1);
  });

  it('falls back to the exit code when output is not parseable', () => {
    const o = parseLintOutcome(eslintPlan, 2, 'eslint: command not found', 'not installed');
    expect(o.ok).toBe(false);
    expect(o.errorCount).toBeNull();
  });
});

describe('parseLintOutcome — prettier', () => {
  it('is OK on a clean exit', () => {
    expect(parseLintOutcome(prettierPlan, 0, 'All matched files use Prettier code style!', '').ok).toBe(true);
  });

  it('lists the unformatted files on a non-zero exit', () => {
    const out = 'Checking formatting...\n[warn] src/App.tsx\n[warn] src/util.ts\nCode style issues found in 2 files.';
    const o = parseLintOutcome(prettierPlan, 1, out, '');
    expect(o.ok).toBe(false);
    expect(o.firstIssues).toContain('src/App.tsx');
    expect(o.firstIssues).toContain('src/util.ts');
  });
});
