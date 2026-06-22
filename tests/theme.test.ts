/**
 * Tests for src/lib/theme.ts — pure theme class computation.
 */
import { describe, it, expect } from 'vitest';
import { getThemeClasses, THEME_MODES } from '../src/lib/theme';
import type { ThemeMode } from '../src/lib/theme';

describe('THEME_MODES', () => {
  it('exports all 5 theme modes', () => {
    expect(THEME_MODES).toHaveLength(5);
    const values = THEME_MODES.map(m => m.value);
    expect(values).toContain('light');
    expect(values).toContain('dark');
    expect(values).toContain('dim');
    expect(values).toContain('comfort');
    expect(values).toContain('contrast');
  });

  it('each mode has a label and value', () => {
    for (const mode of THEME_MODES) {
      expect(typeof mode.label).toBe('string');
      expect(mode.label.length).toBeGreaterThan(0);
      expect(typeof mode.value).toBe('string');
    }
  });
});

describe('getThemeClasses', () => {
  const MODES: ThemeMode[] = ['light', 'dark', 'dim', 'comfort', 'contrast'];

  it('returns an object with the expected shape for every theme', () => {
    for (const mode of MODES) {
      const classes = getThemeClasses(mode);
      expect(typeof classes.bg).toBe('string');
      expect(typeof classes.text).toBe('string');
      expect(typeof classes.border).toBe('string');
      expect(typeof classes.accent).toBe('string');
      expect(typeof classes.card).toBe('string');
      expect(typeof classes.raw.bg).toBe('string');
      expect(typeof classes.raw.text).toBe('string');
      expect(typeof classes.raw.border).toBe('string');
      expect(typeof classes.raw.card).toBe('string');
    }
  });

  it('dark theme has dark background class', () => {
    const { bg } = getThemeClasses('dark');
    expect(bg).toContain('0d1117');
  });

  it('light theme has light background class', () => {
    const { bg } = getThemeClasses('light');
    // Light theme background is a light color (#f8fafc)
    expect(bg).toContain('f8fafc');
  });

  it('each theme returns a distinct background class', () => {
    const bgs = MODES.map(m => getThemeClasses(m).bg);
    const unique = new Set(bgs);
    // All 5 backgrounds should be distinct
    expect(unique.size).toBe(5);
  });

  it('raw.bg values are valid CSS hex or rgba strings', () => {
    for (const mode of MODES) {
      const { raw } = getThemeClasses(mode);
      // Should start with # or rgb
      expect(raw.bg).toMatch(/^(#|rgb)/);
    }
  });
});
