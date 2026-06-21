import { describe, it, expect } from 'vitest';
import { RepairScorer } from '../src/server/AppMakerLab/autorepair/RepairScorer';
import { RepairActionType } from '../src/server/AppMakerLab/autorepair/AutoRepairTypes';
import type { RepairAction } from '../src/server/AppMakerLab/autorepair/AutoRepairTypes';

function action(riskScore: number): RepairAction {
  return {
    type: RepairActionType.UPDATE_IMPORT,
    targetFile: 'src/index.ts',
    reason: 'test',
    expectedOutcome: 'fixed',
    riskScore,
  };
}

describe('RepairScorer.score', () => {
  const scorer = new RepairScorer();

  it('returns a number', () => {
    expect(typeof scorer.score([action(1)])).toBe('number');
  });

  it('returns 0 for actions with very high total risk', () => {
    const actions = Array(10).fill(action(10));
    expect(scorer.score(actions)).toBe(0);
  });

  it('returns higher score for low-risk actions', () => {
    const low = scorer.score([action(1)]);
    const high = scorer.score([action(9)]);
    expect(low).toBeGreaterThan(high);
  });

  it('score decreases as action count increases (even at same risk)', () => {
    const one = scorer.score([action(1)]);
    const many = scorer.score([action(1), action(1), action(1)]);
    expect(one).toBeGreaterThan(many);
  });

  it('never returns a negative score', () => {
    expect(scorer.score([action(10), action(10), action(10)])).toBeGreaterThanOrEqual(0);
  });
});
