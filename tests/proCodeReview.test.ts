import { describe, it, expect } from 'vitest';
import { formatReviewReport } from '../src/server/pro/ProCodeReview';
import type { CodeReviewResult, ReviewFinding } from '../src/server/pro/ProCodeReview';

function finding(severity: ReviewFinding['severity'], file = 'src/App.tsx'): ReviewFinding {
  return { file, severity, category: 'quality', description: `Issue at ${severity}`, fix: 'Fix it' };
}

function result(overrides: Partial<CodeReviewResult> = {}): CodeReviewResult {
  return { findings: [], summary: 'All good', score: 100, techDebt: [], ...overrides };
}

describe('formatReviewReport', () => {
  it('includes the score in the output', () => {
    const report = formatReviewReport(result({ score: 85 }));
    expect(report).toContain('85/100');
  });

  it('includes the summary in the output', () => {
    const report = formatReviewReport(result({ summary: 'One minor issue.' }));
    expect(report).toContain('One minor issue.');
  });

  it('shows "No significant issues" when findings is empty', () => {
    const report = formatReviewReport(result({ findings: [] }));
    expect(report).toContain('No significant issues found');
  });

  it('renders critical findings in the output', () => {
    const report = formatReviewReport(result({ findings: [finding('critical')], score: 10 }));
    expect(report).toContain('Critical');
    expect(report).toContain('src/App.tsx');
  });

  it('groups findings by severity (critical before low)', () => {
    const findings = [finding('low'), finding('critical')];
    const report = formatReviewReport(result({ findings, score: 50 }));
    expect(report.indexOf('Critical')).toBeLessThan(report.indexOf('Low'));
  });

  it('includes a fix hint for each finding', () => {
    const report = formatReviewReport(result({ findings: [finding('medium')], score: 70 }));
    expect(report).toContain('Fix:');
    expect(report).toContain('Fix it');
  });

  it('shows tech debt section when techDebt array is non-empty', () => {
    const report = formatReviewReport(result({ techDebt: ['TODO: refactor login', 'FIXME: null check'] }));
    expect(report).toContain('Tech Debt');
    expect(report).toContain('TODO: refactor login');
  });

  it('caps tech debt display at 10 items', () => {
    const debt = Array.from({ length: 15 }, (_, i) => `TODO item ${i}`);
    const report = formatReviewReport(result({ techDebt: debt }));
    expect(report).toContain('TODO item 9');
    expect(report).not.toContain('TODO item 14');
  });

  it('includes line number when finding has one', () => {
    const f: ReviewFinding = { ...finding('high'), line: 42 };
    const report = formatReviewReport(result({ findings: [f], score: 60 }));
    expect(report).toContain('src/App.tsx:42');
  });
});
