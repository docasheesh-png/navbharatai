// Autopsy BR1972 (2026-11-10). A Hindi/English education ask named the app
// "edu ai examination Assistant". Opened at 390×844 the page scrolled SIDEWAYS by
// 119 px: `<header class="nb-topbar">` “EDU AI – EXAMINATION ASSISTANT” was 508 px
// wide, because the kit drew the topbar as a flex row with nothing letting it
// shrink — a flex item's min-width is its content size, so the long title widened
// the page. The kit is fixed once, for every app built from it. Existing apps that
// already copied the previous rule are not rewritten (only new kit copies, and
// kitRestore of a *dropped* current rule). Chromium headless on this box hangs, so
// these fixtures are CSS declarations plus a 390×844 geometry model, not a live
// Playwright pass. mobileLayoutCheck is not taught to ignore user headers.

import { describe, it, expect } from 'vitest';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { isKnownSeedVersion } from '../src/server/AgentV3/seedVersions';

const NEW_TOPBAR =
  '.nb-topbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--card); flex-wrap: wrap; min-width: 0; max-width: 100%; box-sizing: border-box; overflow-x: auto; }';
const OLD_TOPBAR =
  '.nb-topbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--card); }';

function declarations(selector: string): Record<string, string> {
  const at = DESIGN_KIT_CSS.indexOf(`\n${selector} {`);
  expect(at, `${selector} is in the kit`).toBeGreaterThan(-1);
  const body = DESIGN_KIT_CSS.slice(DESIGN_KIT_CSS.indexOf('{', at) + 1, DESIGN_KIT_CSS.indexOf('}', at));
  return Object.fromEntries(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
}

/** Geometry of this report's header: padding 12px 20px (40 px inline) + a 468 px title = 508 px. */
function topbarOnAPhone(opts: {
  viewport: number;
  titleContent: number;
  paddingInline: number;
  maxWidth100: boolean;
  boxSizingBorderBox: boolean;
  overflowXAuto: boolean;
}): { headerBox: number; pageOverflow: number } {
  const unconstrained = opts.titleContent + opts.paddingInline;
  let headerBox: number;
  if (!opts.maxWidth100) {
    headerBox = unconstrained;
  } else if (opts.boxSizingBorderBox) {
    headerBox = Math.min(opts.viewport, unconstrained);
  } else {
    // max-width: 100% on content-box caps the content box; padding still adds outside.
    headerBox = Math.min(opts.viewport, opts.titleContent) + opts.paddingInline;
  }
  const pageOverflow = opts.overflowXAuto && opts.maxWidth100 && opts.boxSizingBorderBox
    ? 0
    : Math.max(0, headerBox - opts.viewport);
  return { headerBox, pageOverflow };
}

describe('a dashboard topbar that holds a long title fits a phone', () => {
  it('.nb-topbar may shrink to the screen, wrap, and scroll inside itself', () => {
    const d = declarations('.nb-topbar');
    expect(d['min-width']).toBe('0');
    expect(d['max-width']).toBe('100%');
    expect(d['flex-wrap']).toBe('wrap');
    expect(d['box-sizing']).toBe('border-box');
    expect(d['overflow-x']).toBe('auto');
    // what it always was is kept: flex, centred, the same on-grid padding and gap
    expect(d.display).toBe('flex');
    expect(d['align-items']).toBe('center');
    expect(d.gap).toBe('12px');
    expect(d.padding).toBe('12px 20px');
  });

  it('the BR1959 header-action and chip shrink tokens stay as they were', () => {
    const actions = declarations('.nb-header-actions');
    expect(actions['min-width']).toBe('0');
    expect(actions['max-width']).toBe('100%');
    expect(actions['flex-wrap']).toBe('wrap');
    expect(actions.display).toBe('inline-flex');
    const chips = declarations('.nb-chips');
    expect(chips['min-width']).toBe('0');
    expect(chips['max-width']).toBe('100%');
    expect(chips['overflow-x']).toBe('auto');
  });

  it('a 508px title header overflows a 390px phone without the shipped tokens and fits with them', () => {
    const viewport = 390;
    const titleContent = 468;
    const paddingInline = 40; // 20 + 20 from padding: 12px 20px
    const before = topbarOnAPhone({
      viewport, titleContent, paddingInline,
      maxWidth100: false, boxSizingBorderBox: false, overflowXAuto: false,
    });
    expect(before.headerBox).toBe(508);
    // The report recorded 119 px of sideways scroll (508 − 390 = 118; 1 px of subpixel/rounding).
    expect(before.pageOverflow).toBe(118);
    const after = topbarOnAPhone({
      viewport, titleContent, paddingInline,
      maxWidth100: true, boxSizingBorderBox: true, overflowXAuto: true,
    });
    expect(after.headerBox).toBe(390);
    expect(after.pageOverflow).toBe(0);
    // Without box-sizing: border-box, max-width: 100% would still let padding spill past the screen.
    const noBorderBox = topbarOnAPhone({
      viewport, titleContent, paddingInline,
      maxWidth100: true, boxSizingBorderBox: false, overflowXAuto: true,
    });
    expect(noBorderBox.headerBox).toBe(430);
  });

  it('a workspace still holding the kit as it was before this fix is still recognised as OUR starter', () => {
    const before = DESIGN_KIT_CSS
      .replace(/\/\* A dashboard topbar holds the page title[\s\S]*?\*\/\n/, '')
      .replace(NEW_TOPBAR, OLD_TOPBAR);
    expect(before).not.toBe(DESIGN_KIT_CSS);
    expect(before).toContain(OLD_TOPBAR);
    expect(before).not.toContain('overflow-x: auto; }');
    expect(isKnownSeedVersion('src/index.css', before)).toBe(true);
    expect(isKnownSeedVersion('src/index.css', DESIGN_KIT_CSS)).toBe(true);
  });
});
