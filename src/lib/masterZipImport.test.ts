import { describe, it, expect } from 'vitest';
import { shouldFallBackToServer, browserPhaseLabel, partialSaveWarning } from './masterZipImport';

describe('shouldFallBackToServer — when the slow path is the right answer, and when it is not', () => {
  it('falls back for the failures the server might genuinely survive', () => {
    // An old browser, a corrupt central directory, a phone that ran out of memory: the server upload
    // is slower but might still work, and removing it would turn each into a dead end.
    expect(shouldFallBackToServer(new Error('This file could not be read as a zip archive.'))).toBe(true);
    expect(shouldFallBackToServer(new Error('Out of memory'))).toBe(true);
    expect(shouldFallBackToServer(undefined)).toBe(true);
  });

  it('does NOT retry a password-protected archive through a path that will fail more slowly', () => {
    // This is a real answer, not a transport failure. Uploading 1 GB to reach the same verdict five
    // minutes later would be strictly worse for the user than saying it now.
    expect(shouldFallBackToServer(new Error('This zip is password-protected, so it cannot be opened. Export it without a password and try again.'))).toBe(false);
  });
});

describe('browserPhaseLabel', () => {
  it('names the phase the user is actually in', () => {
    expect(browserPhaseLabel({ phase: 'scanning', done: 0, total: 4000 })).toMatch(/opening/i);
    expect(browserPhaseLabel({ phase: 'reading', done: 2000, total: 4000 })).toBe('Reading your project… 50%');
  });

  it('never renders NaN% on an archive whose total is unknown', () => {
    expect(browserPhaseLabel({ phase: 'reading', done: 5, total: 0 })).toBe('Reading your project… 0%');
  });

  it('clamps rather than reporting more than 100%', () => {
    expect(browserPhaseLabel({ phase: 'reading', done: 99, total: 10 })).toBe('Reading your project… 100%');
  });
});

describe('partialSaveWarning', () => {
  it('says nothing when every batch landed', () => {
    expect(partialSaveWarning(0, 400)).toBe('');
  });

  it('refuses to let a partial import read as a whole one', () => {
    const w = partialSaveWarning(2, 300);
    expect(w).toContain('300');
    expect(w).toContain('2');
    expect(w).toMatch(/do not assume the whole project is in yet/i);
  });
});
