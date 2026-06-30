import { describe, it, expect } from 'vitest';
import { formatLessonBlock, lessonSnippet, LESSON_BLOCK_DEFAULTS } from './LessonBlock';

describe('lessonSnippet', () => {
  it('collapses whitespace and trims to the cap with an ellipsis', () => {
    expect(lessonSnippet('  a   b\nc  ')).toBe('a b c');
    expect(lessonSnippet('x'.repeat(200)).length).toBe(LESSON_BLOCK_DEFAULTS.lessonMaxChars);
    expect(lessonSnippet('x'.repeat(200)).endsWith('…')).toBe(true);
  });
});

describe('formatLessonBlock', () => {
  it('returns "" for no lessons (header-only is never emitted)', () => {
    expect(formatLessonBlock('H', [])).toBe('');
    expect(formatLessonBlock('H', ['   ', ''])).toBe('');
  });

  it('renders a header + bullets and caps at maxLessons, preserving input order', () => {
    const out = formatLessonBlock('HEADER', Array.from({ length: 12 }, (_, i) => `lesson ${i}`));
    const bullets = out.split('\n').filter((l) => l.startsWith('- '));
    expect(out.startsWith('HEADER')).toBe(true);
    expect(bullets).toHaveLength(LESSON_BLOCK_DEFAULTS.maxLessons);
    expect(out).toContain('- lesson 0');
    expect(out).toContain('- lesson 5');
    expect(out).not.toContain('- lesson 6');
  });

  it('stays within the block + per-line caps', () => {
    const out = formatLessonBlock('H', Array.from({ length: 6 }, (_, i) => `${'x'.repeat(400)}-${i}`));
    expect(out.length).toBeLessThanOrEqual(LESSON_BLOCK_DEFAULTS.blockMaxChars);
    for (const line of out.split('\n').filter((l) => l.startsWith('- '))) {
      expect(line.length).toBeLessThanOrEqual(2 + LESSON_BLOCK_DEFAULTS.lessonMaxChars);
    }
  });
});
