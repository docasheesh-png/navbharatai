import { describe, it, expect } from 'vitest';
import { generateSettingsScaffoldIntegration } from './SettingsScaffoldGenerator';

describe('generateSettingsScaffoldIntegration', () => {
  const c = generateSettingsScaffoldIntegration();
  const provider = c.files['src/settings/SettingsProvider.tsx'];
  const page = c.files['src/settings/SettingsPage.tsx'];

  it('emits a dependency-free React provider + page (no dep, no env key)', () => {
    expect(provider).toContain('export function SettingsProvider(');
    expect(provider).toContain('export function useSettings()');
    expect(page).toContain('export function SettingsPage()');
    expect((c as { dependencies?: unknown }).dependencies).toBeUndefined();
    expect(c.files['.env.example']).toBeUndefined();
  });

  it('persists preferences AND actually applies the theme (dark mode really works)', () => {
    expect(provider).toContain('localStorage.setItem');
    expect(provider).toContain("document.documentElement.setAttribute('data-theme', resolved)");
    expect(provider).toContain("matchMedia('(prefers-color-scheme: dark)')"); // 'system' resolves correctly
    expect(provider).not.toMatch(/TODO|FIXME/);
  });

  it('the page has grouped sections with working controls wired to the provider', () => {
    expect(page).toContain("update('theme'");
    expect(page).toContain("update('emailNotifications'");
    expect(page).toContain('>Appearance<');
    expect(page).toContain('Reset to defaults');
  });

  it('writes only the two src/settings files', () => {
    expect(Object.keys(c.files).sort()).toEqual([
      'src/settings/SettingsPage.tsx',
      'src/settings/SettingsProvider.tsx',
    ]);
    expect(c.instructions.toLowerCase()).toContain('settings');
  });
});
