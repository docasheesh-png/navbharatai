// Autopsy BR1959 (2026-11-09). A school app put its ten nav links as `.nb-chips` inside `.nb-header-actions`
// (the design kit's own shop-header vocabulary). Opened at 390×844 the page scrolled SIDEWAYS by 990 px:
// `.nb-header-actions` was 1364 px wide, because the kit drew it `display: inline-flex` with nothing letting
// it shrink — an inline-flex box takes its content's full width, so the chip row's own sideways scroll never
// engaged. The kit is fixed once, for every app built from it.

import { describe, it, expect } from 'vitest';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { isKnownSeedVersion } from '../src/server/AgentV3/seedVersions';

function declarations(selector: string): Record<string, string> {
  const at = DESIGN_KIT_CSS.indexOf(`\n${selector} {`);
  expect(at, `${selector} is in the kit`).toBeGreaterThan(-1);
  const body = DESIGN_KIT_CSS.slice(DESIGN_KIT_CSS.indexOf('{', at) + 1, DESIGN_KIT_CSS.indexOf('}', at));
  return Object.fromEntries(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
}

describe('a header action row that holds a whole nav fits a phone', () => {
  it('.nb-header-actions may shrink to the screen and wrap', () => {
    const d = declarations('.nb-header-actions');
    expect(d['min-width']).toBe('0');
    expect(d['max-width']).toBe('100%');
    expect(d['flex-wrap']).toBe('wrap');
    // what it always was is kept: inline, centred, pushed right
    expect(d.display).toBe('inline-flex');
    expect(d['margin-left']).toBe('auto');
  });

  it('.nb-chips inside it scrolls within the screen instead of widening the page', () => {
    const d = declarations('.nb-chips');
    expect(d['min-width']).toBe('0');
    expect(d['max-width']).toBe('100%');
    expect(d['overflow-x']).toBe('auto');
    // chips themselves still never wrap their labels (they scroll in the row)
    expect(declarations('.nb-chip')['white-space']).toBe('nowrap');
  });

  it('a workspace still holding the kit as it was before this fix is still recognised as OUR starter', () => {
    // Reconstructed from today's kit by undoing exactly this change (the comment and the four declarations).
    // Later kit edits (BR1972's .nb-topbar shrink/wrap) must be undone too, or this
    // reconstruction is no longer byte-equal to the recorded pre-BR1959 starter.
    const before = DESIGN_KIT_CSS
      .replace(/\/\* A dashboard topbar holds the page title[\s\S]*?\*\/\n/, '')
      .replace('.nb-topbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--card); flex-wrap: wrap; min-width: 0; max-width: 100%; box-sizing: border-box; overflow-x: auto; }', '.nb-topbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--card); }')
      .replace(/\/\* A header action row may hold a whole nav[\s\S]*?\*\/\n/, '')
      .replace('.nb-header-actions { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; min-width: 0; max-width: 100%; }', '.nb-header-actions { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }')
      .replace('overflow-x: auto; min-width: 0; max-width: 100%; padding: 4px 0;', 'overflow-x: auto; padding: 4px 0;');
    expect(before).not.toBe(DESIGN_KIT_CSS);
    expect(isKnownSeedVersion('src/index.css', before)).toBe(true);
    expect(isKnownSeedVersion('src/index.css', DESIGN_KIT_CSS)).toBe(true);
  });
});
