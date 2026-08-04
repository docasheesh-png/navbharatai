import { describe, it, expect } from 'vitest';
import { combineScreenshotPrompt } from './screenshotPrompt';

describe('combineScreenshotPrompt (admin 2026-07-28)', () => {
  it('THE BUG: the typed instruction is never dropped', () => {
    const out = combineScreenshotPrompt('Build a landing page with a hero and pricing table.', 'but in Hindi');
    expect(out).toContain('but in Hindi');
    expect(out).toContain('hero and pricing table');
  });

  it('puts the user LAST and marks it as taking priority', () => {
    const out = combineScreenshotPrompt('image description', 'use dark mode');
    expect(out.indexOf('use dark mode')).toBeGreaterThan(out.indexOf('image description'));
    expect(out).toContain('take priority');
  });

  it('falls back cleanly when one side is empty (no stray separators)', () => {
    expect(combineScreenshotPrompt('only image', '')).toBe('only image');
    expect(combineScreenshotPrompt('only image', '   ')).toBe('only image');
    expect(combineScreenshotPrompt('', 'only typed')).toBe('only typed');
    expect(combineScreenshotPrompt('', '')).toBe('');
  });

  it('trims both sides so whitespace never becomes content', () => {
    expect(combineScreenshotPrompt('  a  ', '  b  ')).toContain('a\n\n');
    expect(combineScreenshotPrompt('  a  ', '')).toBe('a');
  });
});
