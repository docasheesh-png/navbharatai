import { describe, it, expect, afterEach } from 'vitest';
import {
  cosineSimilarity,
  shouldRemember,
  quantizeEmbedding,
  selectRelevant,
  formatMemoryBlock,
  mergeChunks,
  semanticMemoryEnabled,
  memoryMaxChunks,
  memoryTopK,
  type MemoryChunk,
} from './semanticMemory';

const chunk = (text: string, embedding: number[], ts: number, role: 'user' | 'assistant' = 'user'): MemoryChunk => ({
  text, embedding, ts, role,
});

describe('cosineSimilarity', () => {
  it('is 1 for identical direction, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });
  it('returns 0 for mismatched-length, empty, or zero vectors (never NaN)', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });
});

describe('shouldRemember', () => {
  it('keeps substantive turns', () => {
    expect(shouldRemember('I am allergic to penicillin and sulfa drugs')).toBe(true);
    expect(shouldRemember('My startup does B2B logistics in Pune')).toBe(true);
  });
  it('drops empties, too-short, and bare pleasantries', () => {
    expect(shouldRemember('')).toBe(false);
    expect(shouldRemember('ok')).toBe(false);
    expect(shouldRemember('thanks!')).toBe(false);
    expect(shouldRemember('theek hai')).toBe(false);
    expect(shouldRemember('👍')).toBe(false);
  });
});

describe('quantizeEmbedding', () => {
  it('rounds to the given decimals and preserves length', () => {
    const q = quantizeEmbedding([0.123456789, -0.987654321], 5);
    expect(q).toEqual([0.12346, -0.98765]);
  });
  it('handles a non-array defensively', () => {
    expect(quantizeEmbedding(undefined as any)).toEqual([]);
  });
});

describe('selectRelevant', () => {
  const chunks = [
    chunk('penicillin allergy', [1, 0, 0], 1),
    chunk('likes cricket', [0, 1, 0], 2),
    chunk('works in finance', [0, 0, 1], 3),
  ];
  it('returns the closest chunk(s) above the score threshold, sorted by score', () => {
    const out = selectRelevant([0.9, 0.1, 0], chunks, { topK: 2, minScore: 0.5 });
    expect(out[0].text).toBe('penicillin allergy');
    expect(out.length).toBeLessThanOrEqual(2);
    // scores are descending
    for (let i = 1; i < out.length; i++) expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
  });
  it('drops everything below minScore (nothing relevant → empty)', () => {
    const out = selectRelevant([0, 0, 1], chunks, { topK: 5, minScore: 0.99 });
    expect(out).toHaveLength(1); // only the exact "finance" match clears 0.99
    expect(out[0].text).toBe('works in finance');
  });
  it('excludes texts already in the recent window (case/space-insensitive)', () => {
    const out = selectRelevant([1, 0, 0], chunks, { topK: 5, minScore: 0.1, excludeTexts: ['  Penicillin ALLERGY '] });
    expect(out.find((c) => c.text === 'penicillin allergy')).toBeUndefined();
  });
  it('returns [] for an empty query or empty store', () => {
    expect(selectRelevant([], chunks)).toEqual([]);
    expect(selectRelevant([1, 0, 0], [])).toEqual([]);
  });
});

describe('formatMemoryBlock', () => {
  it('renders relevant chunks oldest-first with role-aware phrasing', () => {
    const block = formatMemoryBlock([
      { ...chunk('allergic to penicillin', [1, 0], 2, 'user'), score: 0.9 },
      { ...chunk('noted your allergy', [1, 0], 1, 'assistant'), score: 0.8 },
    ]);
    expect(block).toContain('RELEVANT THINGS FROM EARLIER');
    // oldest ts first → the assistant line (ts 1) precedes the user line (ts 2)
    expect(block.indexOf('You replied')).toBeLessThan(block.indexOf('They said'));
  });
  it('is empty when there is nothing to recall', () => {
    expect(formatMemoryBlock([])).toBe('');
  });
});

describe('mergeChunks', () => {
  it('appends, dedupes exact repeats (keeping newest ts), caps to newest N, and returns chronological order', () => {
    const existing = [chunk('a', [1], 1), chunk('b', [1], 2)];
    const incoming = [chunk('b', [1], 5), chunk('c', [1], 6)]; // 'b' is a resend with a newer ts
    const merged = mergeChunks(existing, incoming, 2);
    expect(merged.map((c) => c.text)).toEqual(['b', 'c']); // cap=2 keeps the 2 newest, chronological
    const b = merged.find((c) => c.text === 'b')!;
    expect(b.ts).toBe(5); // the newer duplicate won
  });
  it('drops chunks with empty text or empty embedding', () => {
    const merged = mergeChunks([], [chunk('', [1], 1), chunk('ok', [], 2), chunk('real', [0.5], 3)], 10);
    expect(merged.map((c) => c.text)).toEqual(['real']);
  });
});

describe('flags / tunables', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('semanticMemoryEnabled reads truthy flag values only', () => {
    for (const v of ['on', 'true', '1', 'yes', 'ON', 'True']) { process.env.SEMANTIC_MEMORY = v; expect(semanticMemoryEnabled()).toBe(true); }
    for (const v of ['', 'off', 'false', '0', 'no', undefined as any]) { process.env.SEMANTIC_MEMORY = v; expect(semanticMemoryEnabled()).toBe(false); }
  });
  it('memoryMaxChunks / memoryTopK clamp to sane bounds with a safe default', () => {
    delete process.env.SEMANTIC_MEMORY_MAX_CHUNKS; expect(memoryMaxChunks()).toBe(60);
    process.env.SEMANTIC_MEMORY_MAX_CHUNKS = '99999'; expect(memoryMaxChunks()).toBe(400); // clamped to max
    process.env.SEMANTIC_MEMORY_MAX_CHUNKS = '0'; expect(memoryMaxChunks()).toBe(4);       // clamped to min
    process.env.SEMANTIC_MEMORY_MAX_CHUNKS = 'abc'; expect(memoryMaxChunks()).toBe(60);    // default on junk
    delete process.env.SEMANTIC_MEMORY_TOP_K; expect(memoryTopK()).toBe(5);
  });
});
