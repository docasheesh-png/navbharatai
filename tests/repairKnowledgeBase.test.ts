import { describe, it, expect } from 'vitest';
import { RepairKnowledgeBase } from '../src/server/AppMakerLab/repair/RepairKnowledgeBase';
import type { RepairPattern } from '../src/server/AppMakerLab/repair/types/RepairPattern';

function pattern(id: string, fp: string): RepairPattern {
  return { patternId: id, fingerprint: fp, rootCause: 'test', repairStrategy: 'edit', successRate: 0.8, occurrences: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

describe('RepairKnowledgeBase', () => {
  it('findPattern returns undefined for an unknown fingerprint', () => {
    const kb = new RepairKnowledgeBase();
    expect(kb.findPattern('unknown')).toBeUndefined();
  });

  it('findPattern returns the saved pattern by fingerprint', () => {
    const kb = new RepairKnowledgeBase();
    kb.savePattern(pattern('p1', 'fp-abc'));
    expect(kb.findPattern('fp-abc')?.patternId).toBe('p1');
  });

  it('listPatterns returns all saved patterns', () => {
    const kb = new RepairKnowledgeBase();
    kb.savePattern(pattern('p1', 'fp-1'));
    kb.savePattern(pattern('p2', 'fp-2'));
    expect(kb.listPatterns()).toHaveLength(2);
  });

  it('updateSuccessRate increments occurrences', () => {
    const kb = new RepairKnowledgeBase();
    kb.savePattern(pattern('p1', 'fp-x'));
    kb.updateSuccessRate('p1', true);
    expect(kb.listPatterns()[0].occurrences).toBe(2);
  });

  it('updateSuccessRate recalculates successRate as a moving average', () => {
    const kb = new RepairKnowledgeBase();
    // Start with successRate=1.0, occurrences=1
    const p = { ...pattern('p1', 'fp-y'), successRate: 1.0, occurrences: 1 };
    kb.savePattern(p);
    kb.updateSuccessRate('p1', false); // second outcome = 0 → avg = (1.0 + 0) / 2 = 0.5
    expect(kb.listPatterns()[0].successRate).toBeCloseTo(0.5);
  });

  it('updateSuccessRate is a no-op for an unrecognised patternId', () => {
    const kb = new RepairKnowledgeBase();
    expect(() => kb.updateSuccessRate('no-such-id', true)).not.toThrow();
  });
});
