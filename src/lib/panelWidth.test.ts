import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { panelWidth, panelColumns, READING_WIDTH } from './panelWidth';

describe('panelWidth — a desktop screen must not be handed a phone column', () => {
  it('grows with the device: phone < tablet < desktop', () => {
    expect(panelWidth('mobile')).toBe('max-w-xl');
    expect(panelWidth('tablet')).toBe('max-w-3xl');
    expect(panelWidth('desktop')).toBe('max-w-5xl');
  });

  it('every width is a WHOLE literal class — a composed one compiles to nothing', () => {
    // Tailwind emits only classes it can see as source text. `max-w-${x}` would silently produce a
    // page with no width cap at all, which is worse than the bug being fixed.
    for (const mode of ['mobile', 'tablet', 'desktop'] as const) {
      expect(panelWidth(mode)).toMatch(/^max-w-[a-z0-9]+$/);
    }
  });

  it('an unknown mode falls back to the narrow, always-safe column', () => {
    expect(panelWidth('phablet' as never)).toBe('max-w-xl');
  });
});

describe('panelColumns — width alone is not a desktop layout', () => {
  it('only desktop flows cards into columns', () => {
    expect(panelColumns('desktop')).toContain('columns-2');
    expect(panelColumns('tablet')).toBe('');
    expect(panelColumns('mobile')).toBe('');
  });

  it('keeps each card whole — a card split across a column break is a broken page', () => {
    expect(panelColumns('desktop')).toContain('break-inside-avoid');
  });
});

describe('READING_WIDTH — prose is deliberately NOT widened', () => {
  it('stays a readable measure', () => {
    expect(READING_WIDTH).toBe('max-w-xl');
  });
});

// ── The wiring, which is where the bug actually lived ────────────────────────
// Each of the three screens the admin named had its own hard-coded cap. A unit test of the helper
// would pass forever while the screens went on ignoring it.
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (p: string) => codeOnly(readFileSync(join(process.cwd(), p), 'utf8'));

describe('the panels the admin named all ask the shared rule', () => {
  const screens: Array<[name: string, path: string]> = [
    ['Settings (General and every sub-screen)', 'src/components/panels/SettingsPanel.tsx'],
    ['Account', 'src/components/profile/ProfilePage.tsx'],
    ['Your App (APK Builder)', 'src/components/ide/APKBuilder.tsx'],
  ];

  for (const [name, path] of screens) {
    it(`${name} takes its width from panelWidth, not its own number`, () => {
      const body = src(path);
      expect(body).toContain('panelWidth');
      // The literal caps these screens used to carry, which is what pinned them to a phone column.
      expect(body).not.toMatch(/className="[^"]*\bmax-w-3xl mx-auto\b/);
    });

    it(`${name} takes the RESOLVED device mode, not 'auto'`, () => {
      // Deliberately the exact prop name: a page handed the raw setting would have to resolve 'auto'
      // itself, and three screens each resolving it their own way is the drift this change removed.
      expect(src(path)).toContain('effectiveDeviceMode');
    });
  }

  it('the APK Builder is actually HANDED the mode — the compiler cannot check this one', () => {
    // ViewPanels loads its panels through `_lz`, which casts them to ComponentType<any>. Prop types
    // are therefore erased for ~35 panels: dropping this prop would compile cleanly and silently
    // return the page to a phone column. This assertion is the only guard that path has.
    const panels = src('src/components/panels/ViewPanels.tsx');
    const at = panels.indexOf('<APKBuilder');
    expect(at).toBeGreaterThan(-1);
    expect(panels.slice(at, at + 400)).toContain('effectiveDeviceMode={effectiveDeviceMode}');
  });

  it('the legal documents keep the narrow reading measure', () => {
    // Widening prose would be a regression dressed up as the fix.
    expect(src('src/components/panels/SettingsPanel.tsx')).toContain('READING_WIDTH');
  });
});
