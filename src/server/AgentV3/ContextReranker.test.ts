import { describe, it, expect } from 'vitest';
import { tokenize, contentSearchTerms } from './ContextReranker';

describe('tokenize', () => {
  it('lowercases, splits on non-alphanumerics, drops stopwords + 1-char tokens', () => {
    expect(tokenize('Fix the Payment page!')).toEqual(['payment', 'page']);
    expect(tokenize('')).toEqual([]);
  });
});

describe('contentSearchTerms (content-based file retrieval for large repos)', () => {
  it('keeps only salient words long enough to grep for without over-matching', () => {
    // "fix"/"the" are dropped (stopword / short); "credits", "decrement" survive.
    const terms = contentSearchTerms('fix the bug where credits do not decrement on a call');
    expect(terms).toContain('credits');
    expect(terms).toContain('decrement');
    expect(terms).not.toContain('fix');
    expect(terms.every((t) => t.length >= 4)).toBe(true);
  });

  it('dedups and caps the number of terms', () => {
    const terms = contentSearchTerms('subscription subscription payment provider dashboard analytics reporting exporting importing', 4);
    expect(terms.length).toBe(4);
    expect(new Set(terms).size).toBe(terms.length); // no duplicates
  });

  it('returns [] for an empty / stopword-only request (no grep fired)', () => {
    expect(contentSearchTerms('')).toEqual([]);
    expect(contentSearchTerms('please fix it and add a bit')).toEqual([]); // all short/stopwords
  });
});
