import { describe, it, expect } from 'vitest';
import { QualityScorer } from '../src/server/QualityEvaluationEngine/QualityScorer';
import { EvaluationStatus } from '../src/server/QualityEvaluationEngine/QualityTypes';
import type { QualityReport } from '../src/server/QualityEvaluationEngine/QualityTypes';

const PASS = EvaluationStatus.PASS;
const FAIL = EvaluationStatus.FAIL;
const SKIP = EvaluationStatus.SKIPPED;

function report(overrides: Partial<QualityReport> = {}): QualityReport {
  return {
    buildStatus: PASS, lintStatus: PASS, runtimeStatus: PASS, securityStatus: PASS, architectureStatus: PASS,
    errors: [], warnings: [], recommendations: [], overallScore: 0,
    ...overrides,
  };
}

describe('QualityScorer.score', () => {
  const scorer = new QualityScorer();

  it('returns 100 for all PASS with no errors or warnings', () => {
    // build(25) + lint(15) + runtime(25) + security(20) + arch(15) = 100
    expect(scorer.score(report())).toBe(100);
  });

  it('returns 0 when all statuses are FAIL', () => {
    expect(scorer.score(report({ buildStatus: FAIL, lintStatus: FAIL, runtimeStatus: FAIL, securityStatus: FAIL, architectureStatus: FAIL }))).toBe(0);
  });

  it('counts build PASS as +25', () => {
    const r = report({ lintStatus: FAIL, runtimeStatus: FAIL, securityStatus: FAIL, architectureStatus: FAIL });
    expect(scorer.score(r)).toBe(25);
  });

  it('counts lint PASS as +15', () => {
    const r = report({ buildStatus: FAIL, runtimeStatus: FAIL, securityStatus: FAIL, architectureStatus: FAIL });
    expect(scorer.score(r)).toBe(15);
  });

  it('counts security PASS as +20', () => {
    const r = report({ buildStatus: FAIL, lintStatus: FAIL, runtimeStatus: FAIL, architectureStatus: FAIL });
    expect(scorer.score(r)).toBe(20);
  });

  it('deducts 2 points per error (capped at 10)', () => {
    // All PASS = 100; 3 errors = -6 → 94
    expect(scorer.score(report({ errors: ['e1', 'e2', 'e3'] }))).toBe(94);
  });

  it('caps error deduction at 10 even with many errors', () => {
    // All PASS = 100; 10 errors = -10 → 90; 20 errors → still -10 = 90
    expect(scorer.score(report({ errors: Array(20).fill('e') }))).toBe(90);
  });

  it('deducts 1 point per warning (capped at 5)', () => {
    // All PASS = 100; 3 warnings = -3 → 97
    expect(scorer.score(report({ warnings: ['w1', 'w2', 'w3'] }))).toBe(97);
  });

  it('caps warning deduction at 5', () => {
    // All PASS = 100; 10 warnings → max -5 = 95
    expect(scorer.score(report({ warnings: Array(10).fill('w') }))).toBe(95);
  });

  it('never returns a score below 0', () => {
    const r = report({ buildStatus: FAIL, lintStatus: FAIL, runtimeStatus: FAIL, securityStatus: FAIL, architectureStatus: FAIL, errors: Array(10).fill('e'), warnings: Array(10).fill('w') });
    expect(scorer.score(r)).toBe(0);
  });

  it('SKIPPED status contributes 0 points (same as FAIL)', () => {
    const r = report({ buildStatus: SKIP, lintStatus: SKIP, runtimeStatus: SKIP, securityStatus: SKIP, architectureStatus: SKIP });
    expect(scorer.score(r)).toBe(0);
  });
});
