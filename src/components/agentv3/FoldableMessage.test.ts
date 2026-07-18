import { describe, it, expect } from 'vitest';
import { shouldFoldMessage } from './FoldableMessage';

describe('shouldFoldMessage', () => {
  it('does NOT fold a short single-line message', () => {
    expect(shouldFoldMessage('add a 30s rest option')).toBe(false);
  });

  it('folds a message longer than the char threshold', () => {
    expect(shouldFoldMessage('x'.repeat(701))).toBe(true);
    expect(shouldFoldMessage('x'.repeat(699))).toBe(false);
  });

  it('folds a message with many lines even when short in chars', () => {
    expect(shouldFoldMessage('a\n'.repeat(13))).toBe(true); // 14 lines
    expect(shouldFoldMessage('a\n'.repeat(10))).toBe(false); // 11 lines
  });

  it('respects custom thresholds', () => {
    expect(shouldFoldMessage('hello', 3)).toBe(true);
    expect(shouldFoldMessage('hi', 3)).toBe(false);
  });

  it('is safe on non-string / empty input', () => {
    expect(shouldFoldMessage(null as unknown as string)).toBe(false);
    expect(shouldFoldMessage('')).toBe(false);
  });
});
