import { describe, it, expect } from 'vitest';
import { RepairConfidenceEngine } from '../src/server/AppMakerLab/repair/RepairConfidenceEngine';

function signals(overrides: Partial<{ buildPass: boolean; lintPass: boolean; typePass: boolean; previewPass: boolean; architecturePass: boolean }> = {}) {
  return {
    buildPass: true,
    lintPass: true,
    typePass: true,
    previewPass: true,
    architecturePass: true,
    ...overrides,
  };
}

describe('RepairConfidenceEngine.evaluate', () => {
  const engine = new RepairConfidenceEngine();

  it('returns score 100 when all signals pass', () => {
    expect(engine.evaluate(signals()).score).toBe(100);
  });

  it('returns score 0 when all signals fail', () => {
    expect(engine.evaluate(signals({ buildPass: false, lintPass: false, typePass: false, previewPass: false, architecturePass: false })).score).toBe(0);
  });

  it('canAutoMerge is true when score >= 90', () => {
    expect(engine.evaluate(signals()).canAutoMerge).toBe(true);
  });

  it('canAutoMerge is false when score < 90', () => {
    const result = engine.evaluate(signals({ buildPass: false }));
    expect(result.canAutoMerge).toBe(false);
  });

  it('requiresEscalation is false when score >= 70', () => {
    expect(engine.evaluate(signals()).requiresEscalation).toBe(false);
  });

  it('requiresEscalation is true when score < 70', () => {
    const result = engine.evaluate(signals({ buildPass: false, lintPass: false, typePass: false }));
    expect(result.requiresEscalation).toBe(true);
  });

  it('buildPass contributes 25 points', () => {
    const only = engine.evaluate(signals({ lintPass: false, typePass: false, previewPass: false, architecturePass: false }));
    expect(only.score).toBe(25);
  });

  it('previewPass contributes 20 points', () => {
    const only = engine.evaluate(signals({ buildPass: false, lintPass: false, typePass: false, architecturePass: false }));
    expect(only.score).toBe(20);
  });
});
