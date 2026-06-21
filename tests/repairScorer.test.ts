import { describe, it, expect } from 'vitest';
import { RepairScorer } from '../src/server/AppMakerLab/autorepair/RepairScorer';
import { RepairActionType } from '../src/server/AppMakerLab/autorepair/AutoRepairTypes';
import type { RepairAction } from '../src/server/AppMakerLab/autorepair/AutoRepairTypes';

function action(riskScore: number): RepairAction {
  return { type: RepairActionType.EDIT_FILE, targetFile: 'src/App.tsx', reason: 'test', expectedOutcome: 'ok', riskScore };
}

describe('RepairScorer.score', () => {
  const scorer = new RepairScorer();

  it('returns 100 for an empty action list', () => {
    // formula: floor(max(0, 100 - 0) / (1 + 0)) = floor(100) = 100
    expect(scorer.score([])).toBe(100);
  });

  it('returns 90 for a single zero-risk action', () => {
    // floor(100 / 1.1) = floor(90.9) = 90
    expect(scorer.score([action(0)])).toBe(90);
  });

  it('returns 45 for a single high-risk action (riskScore=10)', () => {
    // totalRisk=10 → 100 - 50 = 50; floor(50 / 1.1) = floor(45.45) = 45
    expect(scorer.score([action(10)])).toBe(45);
  });

  it('returns 83 for two zero-risk actions', () => {
    // floor(100 / 1.2) = floor(83.3) = 83
    expect(scorer.score([action(0), action(0)])).toBe(83);
  });

  it('returns 0 when total risk is very high (riskScore=20)', () => {
    // 100 - 100 = 0, max(0,0)=0, floor(0 / 1.1) = 0
    expect(scorer.score([action(20)])).toBe(0);
  });

  it('score is non-negative — never goes below 0', () => {
    const extremeActions = Array.from({ length: 5 }, () => action(10));
    expect(scorer.score(extremeActions)).toBeGreaterThanOrEqual(0);
  });
});
