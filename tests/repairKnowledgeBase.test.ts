import { describe, it, expect } from 'vitest';
import { RepairKnowledgeBase } from '../src/server/AppMakerLab/repair/RepairKnowledgeBase';
import type { RepairPattern } from '../src/server/AppMakerLab/repair/types/RepairPattern';

function makePattern(patternId: string, fingerprint: string): RepairPattern {
  return {
    patternId, fingerprint,
    rootCause: 'missing import',
    repairStrategy: 'add import',
    successRate: 1.0,
    occurrences: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('RepairKnowledgeBase', () => {
  it('starts with empty patterns', () => {
    const kb = new RepairKnowledgeBase();
    expect(kb.listPatterns()).toHaveLength(0);
  });

  it('saves and finds a pattern by fingerprint', () => {
    const kb = new RepairKnowledgeBase();
    kb.savePattern(makePattern('p1', 'fp-abc'));
    expect(kb.findPattern('fp-abc')).toBeDefined();
    expect(kb.findPattern('fp-abc')?.patternId).toBe('p1');
  });

  it('returns undefined for unknown fingerprint', () => {
    const kb = new RepairKnowledgeBase();
    expect(kb.findPattern('unknown')).toBeUndefined();
  });

  it('updates success rate correctly', () => {
    const kb = new RepairKnowledgeBase();
    kb.savePattern(makePattern('p1', 'fp-1'));
    kb.updateSuccessRate('p1', false);
    const p = kb.listPatterns()[0];
    // Initial successRate=1, occurrences=1; after 1 failure with 2 occurrences:
    // (1.0 * 1 + 0) / 2 = 0.5
    expect(p.successRate).toBe(0.5);
    expect(p.occurrences).toBe(2);
  });

  it('listPatterns returns all saved patterns', () => {
    const kb = new RepairKnowledgeBase();
    kb.savePattern(makePattern('p1', 'fp-1'));
    kb.savePattern(makePattern('p2', 'fp-2'));
    expect(kb.listPatterns()).toHaveLength(2);
  });
});
