import { describe, it, expect } from 'vitest';
import { evolveLessons, type Lesson } from './KnowledgeEvolution';

const L = (text: string, score = 1, ts?: number): Lesson => ({ text, score, ts });

describe('evolveLessons — de-duplication', () => {
  it('collapses exact duplicates (case/tag-insensitive) to one', () => {
    const out = evolveLessons([
      L('Avoid mutating state directly'),
      L('[reflection] avoid mutating state directly'),
      L('AVOID MUTATING STATE DIRECTLY'),
    ]);
    expect(out).toHaveLength(1);
  });

  it('collapses near-duplicates but keeps genuinely different lessons', () => {
    const out = evolveLessons([
      L('use react-router-dom v6 for routing'),
      L('use react-router-dom v6 for the routing'), // near-dup
      L('install tailwind for styling'),            // distinct
    ]);
    expect(out).toHaveLength(2);
    expect(out.some((t) => /react-router-dom/.test(t))).toBe(true);
    expect(out.some((t) => /tailwind/.test(t))).toBe(true);
  });

  it('does NOT collapse lessons that merely share a few common words', () => {
    const out = evolveLessons(Array.from({ length: 5 }, (_, i) => L(`lesson number ${i}`)));
    expect(out).toHaveLength(5);
  });
});

describe('evolveLessons — conflict resolution (newer wins)', () => {
  it('drops stale advice contradicted by a newer lesson of opposite polarity', () => {
    const out = evolveLessons([
      L('use local component state for the form', 1, 1000),       // older
      L('do not use local component state for the form', 1, 5000), // newer, contradicts
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/do not use local component state/i);
  });

  it('keeps the newer even when the older is listed second', () => {
    const out = evolveLessons([
      L('avoid inline styles in components', 1, 9000),  // newer
      L('use inline styles in components', 1, 1000),    // older, contradicts
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/avoid inline styles/i);
  });

  it('does not treat unrelated lessons as conflicts even if one is negated', () => {
    const out = evolveLessons([
      L('use react-router-dom v6 API'),
      L('module not found error came from a missing dependency'),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('evolveLessons — recency ranking (aging)', () => {
  it('ranks fresher lessons above equally-relevant older ones', () => {
    const out = evolveLessons([
      L('older lesson about caching', 1, 1000),
      L('fresher lesson about pagination', 1, 9000),
    ]);
    expect(out[0]).toMatch(/pagination/);
  });

  it('higher relevance still wins over mere recency', () => {
    const out = evolveLessons([
      L('very relevant lesson', 3, 1000),
      L('less relevant but newer', 1, 9000),
    ]);
    expect(out[0]).toMatch(/very relevant/);
  });

  it('preserves input order among equal-rank lessons (stable)', () => {
    const out = evolveLessons([L('alpha'), L('bravo'), L('charlie')]);
    expect(out).toEqual(['alpha', 'bravo', 'charlie']);
  });
});

describe('evolveLessons — robustness', () => {
  it('ignores empty/whitespace lessons and returns [] for empty input', () => {
    expect(evolveLessons([])).toEqual([]);
    expect(evolveLessons([L('   '), L('')])).toEqual([]);
  });
});
