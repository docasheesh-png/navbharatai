import { describe, it, expect } from 'vitest';
import { RepairConfidenceEngine } from '../src/server/AppMakerLab/repair/RepairConfidenceEngine';
import type { RepairConfidenceResult } from '../src/server/AppMakerLab/repair/types/RepairConfidence';

type Signals = RepairConfidenceResult['signals'];

function allPass(): Signals {
  return { buildPass: true, lintPass: true, typePass: true, previewPass: true, architecturePass: true };
}
function allFail(): Signals {
  return { buildPass: false, lintPass: false, typePass: false, previewPass: false, architecturePass: false };
}

describe('RepairConfidenceEngine.evaluate', () => {
  const engine = new RepairConfidenceEngine();

  it('returns score 100 when all signals pass (25+20+20+20+15)', () => {
    expect(engine.evaluate(allPass()).score).toBe(100);
  });

  it('returns score 0 when all signals fail', () => {
    expect(engine.evaluate(allFail()).score).toBe(0);
  });

  it('canAutoMerge is true when score >= 90', () => {
    // all pass → 100 ≥ 90
    expect(engine.evaluate(allPass()).canAutoMerge).toBe(true);
  });

  it('canAutoMerge is false when score < 90', () => {
    // buildPass + lintPass + typePass = 25+20+20 = 65 < 90
    const signals: Signals = { ...allFail(), buildPass: true, lintPass: true, typePass: true };
    expect(engine.evaluate(signals).canAutoMerge).toBe(false);
  });

  it('requiresEscalation is true when score < 70', () => {
    // buildPass only = 25 < 70
    const signals: Signals = { ...allFail(), buildPass: true };
    expect(engine.evaluate(signals).requiresEscalation).toBe(true);
  });

  it('requiresEscalation is false when score >= 70', () => {
    // buildPass + lintPass + typePass + previewPass = 25+20+20+20 = 85 ≥ 70
    const signals: Signals = { ...allFail(), buildPass: true, lintPass: true, typePass: true, previewPass: true };
    expect(engine.evaluate(signals).requiresEscalation).toBe(false);
  });

  it('reflects the input signals in the result unchanged', () => {
    const signals = allPass();
    expect(engine.evaluate(signals).signals).toEqual(signals);
  });

  it('each signal contributes the correct point value', () => {
    // lintPass alone = 20
    expect(engine.evaluate({ ...allFail(), lintPass: true }).score).toBe(20);
    // typePass alone = 20
    expect(engine.evaluate({ ...allFail(), typePass: true }).score).toBe(20);
    // previewPass alone = 20
    expect(engine.evaluate({ ...allFail(), previewPass: true }).score).toBe(20);
    // architecturePass alone = 15
    expect(engine.evaluate({ ...allFail(), architecturePass: true }).score).toBe(15);
  });
});
