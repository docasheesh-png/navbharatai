/**
 * Tests for src/lib/theme.ts — the three-theme vocabulary and the migration of the two retired ones
 * (theme replacement, PR B — admin 2026-09-18).
 */
import { describe, it, expect } from 'vitest';
import { THEME_MODES, LEGACY_THEME_MAP, isThemeMode, normalizeThemeMode } from '../src/lib/theme';
import * as theme from '../src/lib/theme';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { codeOnly } from '../scripts/themeColourBaseline.mjs';

describe('THEME_MODES — three themes, no more', () => {
  it('exports exactly Light, Dark and High contrast', () => {
    expect(THEME_MODES.map(m => m.value)).toEqual(['light', 'dark', 'contrast']);
  });

  it('each mode has a non-empty label a user can read', () => {
    for (const mode of THEME_MODES) {
      expect(mode.label.length).toBeGreaterThan(0);
    }
  });

  it('🔒 getThemeClasses is gone — colour comes from tokens, never from a per-theme class bag', () => {
    expect((theme as Record<string, unknown>).getThemeClasses).toBeUndefined();
  });
});

describe('normalizeThemeMode — a saved value from any version of the app lands on a live theme', () => {
  it('passes the three live themes through unchanged', () => {
    for (const t of ['light', 'dark', 'contrast'] as const) expect(normalizeThemeMode(t)).toBe(t);
  });

  it('carries the two retired themes to their successors (dim → dark, comfort → light)', () => {
    expect(normalizeThemeMode('dim')).toBe('dark');
    expect(normalizeThemeMode('comfort')).toBe('light');
    expect(LEGACY_THEME_MAP).toEqual({ dim: 'dark', comfort: 'light' });
  });

  it('returns null for nothing, whitespace, or a value no version ever wrote — the caller then asks the OS', () => {
    for (const raw of [null, undefined, '', '  ', 'sepia', 'DARK', 'undefined']) {
      expect(normalizeThemeMode(raw)).toBeNull();
    }
  });

  it('tolerates surrounding whitespace on a real value', () => {
    expect(normalizeThemeMode(' dark ')).toBe('dark');
  });

  it('isThemeMode is the same predicate the type is built on', () => {
    expect(isThemeMode('contrast')).toBe(true);
    expect(isThemeMode('dim')).toBe(false);
    expect(isThemeMode(42)).toBe(false);
  });
});

describe('the stored value is migrated where it is READ, not only where it is typed', () => {
  // No DOM environment in this suite, so the hook is not rendered; the real-browser smoke check
  // (stored "dim" → data-theme="dark", storage rewritten) is recorded in PROGRESS.md 2026-09-18.
  // This pins the two lines that behaviour depends on so a refactor cannot drop them silently.
  const hook = codeOnly(readFileSync(resolve(__dirname, '../src/hooks/useSettings.ts'), 'utf8'));
  it('useSettings normalises what localStorage holds instead of casting it to ThemeMode', () => {
    expect(hook).toContain('normalizeThemeMode(raw)');
    expect(hook).not.toContain("as ThemeMode | null");
  });
  it('and writes the migrated value back, so the pre-paint script sees a live theme next visit', () => {
    expect(hook).toContain("localStorage.setItem('theme', saved)");
  });
});
