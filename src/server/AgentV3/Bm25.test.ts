import { describe, it, expect } from 'vitest';
import { bm25, bm25Tokenize } from './Bm25';

describe('bm25Tokenize', () => {
  it('lowercases, splits on non-alphanumerics, drops short tokens and stopwords', () => {
    expect(bm25Tokenize('Build the Countdown Timer!')).toEqual(['build', 'countdown', 'timer']);
    // 'a', 'to' are too short; 'the'/'and' are stopwords.
    expect(bm25Tokenize('a to the and Stripe')).toEqual(['stripe']);
  });
  it('returns [] for empty input', () => {
    expect(bm25Tokenize('')).toEqual([]);
  });
});

describe('bm25', () => {
  it('weights a RARE discriminating term above a common one (IDF)', () => {
    // "page" appears in 4 of 5 docs (common, low IDF); "checkout" in 1 (rare, high IDF).
    const docs = [
      { id: 'A', text: 'checkout flow' },
      { id: 'B', text: 'home page' },
      { id: 'C', text: 'about page' },
      { id: 'D', text: 'contact page' },
      { id: 'E', text: 'pricing page' },
    ];
    const scores = bm25('checkout page', docs);
    // The doc with the rare term must outrank a doc with only the common term.
    expect(scores.get('A')!).toBeGreaterThan(scores.get('B')!);
    expect(scores.get('A')!).toBeGreaterThan(0);
  });

  it('a doc that shares NO query term scores 0', () => {
    const docs = [
      { id: 'A', text: 'stripe webhook signature' },
      { id: 'B', text: 'completely unrelated content' },
    ];
    const scores = bm25('stripe webhook', docs);
    expect(scores.get('A')!).toBeGreaterThan(0);
    expect(scores.get('B')).toBe(0);
  });

  it('saturates term frequency (spamming a word cannot run away)', () => {
    const docs = [
      { id: 'once', text: 'login form' },
      { id: 'spam', text: 'login login login login login login form' },
    ];
    const scores = bm25('login', docs);
    // More occurrences still scores higher, but not 6× — TF saturation (k1) + length penalty (b).
    const ratio = scores.get('spam')! / scores.get('once')!;
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(3);
  });

  it('returns an all-zero map for an empty query and an empty map for no docs', () => {
    const docs = [{ id: 'A', text: 'anything' }];
    expect([...bm25('', docs).values()]).toEqual([0]);
    expect(bm25('x', []).size).toBe(0);
  });
});
