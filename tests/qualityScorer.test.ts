import { describe, it, expect } from 'vitest';
import { QualityScorer } from '../src/server/QualityEvaluationEngine/QualityScorer';
import { EvaluationStatus } from '../src/server/QualityEvaluationEngine/QualityTypes';
import type { QualityReport } from '../src/server/QualityEvaluationEngine/QualityTypes';

function makeReport(overrides: Partial<QualityReport> = {}): QualityReport {
  return {
    buildStatus: EvaluationStatus.PASS,
    lintStatus: EvaluationStatus.PASS,
    runtimeStatus: EvaluationStatus.PASS,
    securityStatus: EvaluationStatus.PASS,
    architectureStatus: EvaluationStatus.PASS,
    errors: [],
    warnings: [],
    recommendations: [],
    overallScore: 0,
    ...overrides,
  };
}

describe('QualityScorer', () => {
  it('returns 100 when all PASS and no errors/warnings', () => {
    const scorer = new QualityScorer();
    expect(scorer.score(makeReport())).toBe(100);
  });

  it('returns 75 when only buildStatus fails (25 pts lost)', () => {
    const scorer = new QualityScorer();
    expect(scorer.score(makeReport({ buildStatus: EvaluationStatus.FAIL }))).toBe(75);
  });

  it('returns 85 when only lintStatus fails (15 pts lost)', () => {
    const scorer = new QualityScorer();
    expect(scorer.score(makeReport({ lintStatus: EvaluationStatus.FAIL }))).toBe(85);
  });

  it('deducts 2 pts per error, capped at 10', () => {
    const scorer = new QualityScorer();
    // 6 errors → 12 pts but capped at 10 → score = 90
    expect(scorer.score(makeReport({ errors: Array(6).fill('e') }))).toBe(90);
  });

  it('deducts 1 pt per warning, capped at 5', () => {
    const scorer = new QualityScorer();
    // 6 warnings → 6 pts but capped at 5 → score = 95
    expect(scorer.score(makeReport({ warnings: Array(6).fill('w') }))).toBe(95);
  });

  it('returns 0 when all fail with max errors', () => {
    const scorer = new QualityScorer();
    const report = makeReport({
      buildStatus: EvaluationStatus.FAIL,
      lintStatus: EvaluationStatus.FAIL,
      runtimeStatus: EvaluationStatus.FAIL,
      securityStatus: EvaluationStatus.FAIL,
      architectureStatus: EvaluationStatus.FAIL,
      errors: Array(10).fill('e'),
      warnings: Array(10).fill('w'),
    });
    expect(scorer.score(report)).toBe(0);
  });
});
