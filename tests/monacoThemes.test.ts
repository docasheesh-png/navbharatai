import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EDITOR_THEMES, CUSTOM_THEME_DATA, isValidTheme, registerEditorThemes,
  loadSavedTheme, saveTheme, DEFAULT_EDITOR_THEME,
} from '../src/components/ide/monacoThemes';

/**
 * P-DEV.9 — Monaco editor theme switcher.
 */
describe('monacoThemes — catalog', () => {
  it('lists the two built-ins + three custom themes', () => {
    expect(EDITOR_THEMES.map((t) => t.id)).toEqual(['vs-dark', 'vs', 'monokai', 'dracula', 'solarized-dark']);
    expect(EDITOR_THEMES.filter((t) => t.custom).map((t) => t.id)).toEqual(['monokai', 'dracula', 'solarized-dark']);
  });

  it('every custom theme has a definition with a base, rules, and a background color', () => {
    for (const t of EDITOR_THEMES.filter((x) => x.custom)) {
      const data = CUSTOM_THEME_DATA[t.id];
      expect(data).toBeTruthy();
      expect(['vs', 'vs-dark']).toContain(data.base);
      expect(data.rules.length).toBeGreaterThan(0);
      expect(data.colors['editor.background']).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('monacoThemes — isValidTheme', () => {
  it('accepts known ids, rejects others', () => {
    expect(isValidTheme('dracula')).toBe(true);
    expect(isValidTheme('vs-dark')).toBe(true);
    expect(isValidTheme('nope')).toBe(false);
    expect(isValidTheme(null)).toBe(false);
    expect(isValidTheme(42)).toBe(false);
  });
});

describe('monacoThemes — registerEditorThemes', () => {
  it('defines exactly the custom themes on the monaco instance', () => {
    const defineTheme = vi.fn();
    registerEditorThemes({ editor: { defineTheme } });
    expect(defineTheme).toHaveBeenCalledTimes(3);
    const names = defineTheme.mock.calls.map((c) => c[0]).sort();
    expect(names).toEqual(['dracula', 'monokai', 'solarized-dark']);
  });
});

describe('monacoThemes — persistence', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
  });

  it('round-trips a valid theme', () => {
    saveTheme('monokai');
    expect(loadSavedTheme()).toBe('monokai');
  });

  it('ignores an invalid stored value and uses the fallback', () => {
    localStorage.setItem('editorTheme', 'garbage');
    expect(loadSavedTheme()).toBe(DEFAULT_EDITOR_THEME);
    expect(loadSavedTheme('vs')).toBe('vs');
  });

  it('does not persist an invalid theme', () => {
    // @ts-expect-error — deliberately invalid
    saveTheme('not-a-theme');
    expect(loadSavedTheme()).toBe(DEFAULT_EDITOR_THEME);
  });
});
