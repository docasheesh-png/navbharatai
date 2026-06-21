import { describe, it, expect } from 'vitest';
import { ArchitectureSelector } from '../src/server/AppMakerLab/intelligence/ArchitectureSelector';
import { PATTERN_LIBRARY } from '../src/server/AppMakerLab/intelligence/PatternLibrary';

describe('ArchitectureSelector.select', () => {
  const selector = new ArchitectureSelector();

  function ranked(patterns: typeof PATTERN_LIBRARY, scores: number[]) {
    return patterns.map((pattern, i) => ({
      pattern,
      score: scores[i] ?? 0,
      matchedConstraints: ['scalability'],
      rejectedConstraints: [],
    }));
  }

  it('picks the first (highest-scored) ranked pattern', () => {
    const rankedPatterns = ranked(PATTERN_LIBRARY, [80, 50, 30]);
    const result = selector.select({} as any, rankedPatterns);
    expect(result.stack).toEqual(PATTERN_LIBRARY[0].defaultStack);
  });

  it('carries the score from the ranked pattern into the result', () => {
    const rankedPatterns = ranked(PATTERN_LIBRARY, [42, 10]);
    const result = selector.select({} as any, rankedPatterns);
    expect(result.score).toBe(42);
  });

  it('propagates matchedConstraints from the top pattern', () => {
    const rankedPatterns = ranked(PATTERN_LIBRARY, [60]);
    const result = selector.select({} as any, rankedPatterns);
    expect(result.matchedConstraints).toContain('scalability');
  });

  it('rationale mentions the selected pattern id', () => {
    const rankedPatterns = ranked(PATTERN_LIBRARY, [99]);
    const result = selector.select({} as any, rankedPatterns);
    expect(result.rationale[0]).toContain(PATTERN_LIBRARY[0].id);
  });
});
