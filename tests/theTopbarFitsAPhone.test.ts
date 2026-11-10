// Autopsy BR1972 (2026-11-10). A Hindi/English education ask named the app
// "edu ai examination Assistant". Opened at 390×844 the page scrolled SIDEWAYS by
// 119 px: `<header class="nb-topbar">` “EDU AI – EXAMINATION ASSISTANT” was 508 px
// wide, because the kit drew the topbar as a flex row with nothing letting it
// shrink — a flex item's min-width is its content size, so the long title widened
// the page. The kit is fixed once, for every app built from it. Existing apps that
// already copied a previous rule are not rewritten (only new kit copies, and
// kitRestore of a *dropped* current rule). Chromium headless on this box hangs, so
// these fixtures are CSS declarations plus a 390×844 geometry model, not a live
// Playwright pass. mobileLayoutCheck is not taught to ignore user headers.
//
// Reviewer FAIL on the first head: overflow-x:auto on .nb-topbar forces overflow-y
// to auto (CSS Overflow), which clips absolute dropdowns and popovers inside the
// bar. Today's rule keeps shrink/wrap/border-box and uses overflow-wrap:anywhere
// so an unbreakable title breaks; overflow is left visible.

import { describe, it, expect } from 'vitest';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { isKnownSeedVersion } from '../src/server/AgentV3/seedVersions';

const NEW_TOPBAR =
  '.nb-topbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--card); flex-wrap: wrap; min-width: 0; max-width: 100%; box-sizing: border-box; overflow-wrap: anywhere; }';
const FIRST_PR_TOPBAR =
  '.nb-topbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--card); flex-wrap: wrap; min-width: 0; max-width: 100%; box-sizing: border-box; overflow-x: auto; }';
const OLD_TOPBAR =
  '.nb-topbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--card); }';

function declarations(selector: string): Record<string, string> {
  const at = DESIGN_KIT_CSS.indexOf(`\n${selector} {`);
  expect(at, `${selector} is in the kit`).toBeGreaterThan(-1);
  const body = DESIGN_KIT_CSS.slice(DESIGN_KIT_CSS.indexOf('{', at) + 1, DESIGN_KIT_CSS.indexOf('}', at));
  return Object.fromEntries(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
}

/**
 * CSS Overflow: if overflow-x is not visible, a missing/visible overflow-y computes to auto
 * (and vice versa). A non-visible computed axis makes the box a scroll container that clips
 * absolutely positioned descendants overflowing that axis.
 */
function computedOverflow(declared: Record<string, string>): { x: string; y: string } {
  const ox = declared['overflow-x'] ?? declared.overflow ?? 'visible';
  const oy = declared['overflow-y'] ?? declared.overflow ?? 'visible';
  return {
    x: ox === 'visible' && oy !== 'visible' ? 'auto' : ox,
    y: oy === 'visible' && ox !== 'visible' ? 'auto' : oy,
  };
}

function clipsAbsoluteDropdown(declared: Record<string, string>): boolean {
  const { x, y } = computedOverflow(declared);
  return x !== 'visible' || y !== 'visible';
}

/** How many pixels of a menu that opens below the bar are clipped by a scroll container. */
function dropdownClippedPx(opts: {
  topbarHeight: number;
  dropdownTop: number;
  dropdownHeight: number;
  overflowY: string;
}): number {
  if (opts.overflowY === 'visible') return 0;
  return Math.max(0, opts.dropdownTop + opts.dropdownHeight - opts.topbarHeight);
}

/** Geometry of this report's header: padding 12px 20px (40 px inline) + a 468 px title = 508 px. */
function topbarOnAPhone(opts: {
  viewport: number;
  titleContent: number;
  paddingInline: number;
  maxWidth100: boolean;
  boxSizingBorderBox: boolean;
  overflowWrapAnywhere: boolean;
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
  // An unbreakable title wraps/breaks inside the bar when overflow-wrap:anywhere is inherited.
  // overflow-x:auto is NOT a way this test is allowed to pass (it would clip dropdowns).
  const pageOverflow = opts.maxWidth100 && opts.boxSizingBorderBox && opts.overflowWrapAnywhere
    ? 0
    : Math.max(0, headerBox - opts.viewport);
  return { headerBox, pageOverflow };
}

describe('a dashboard topbar that holds a long title fits a phone', () => {
  it('.nb-topbar may shrink to the screen and wrap', () => {
    const d = declarations('.nb-topbar');
    expect(d['min-width']).toBe('0');
    expect(d['max-width']).toBe('100%');
    expect(d['flex-wrap']).toBe('wrap');
    expect(d['box-sizing']).toBe('border-box');
    expect(d['overflow-wrap']).toBe('anywhere');
    // what it always was is kept: flex, centred, the same on-grid padding and gap
    expect(d.display).toBe('flex');
    expect(d['align-items']).toBe('center');
    expect(d.gap).toBe('12px');
    expect(d.padding).toBe('12px 20px');
  });

  it('.nb-topbar has no overflow / overflow-x / overflow-y other than visible', () => {
    const d = declarations('.nb-topbar');
    for (const prop of ['overflow', 'overflow-x', 'overflow-y'] as const) {
      expect(d[prop] === undefined || d[prop] === 'visible', `${prop}=${d[prop]}`).toBe(true);
    }
    const computed = computedOverflow(d);
    expect(computed.x).toBe('visible');
    expect(computed.y).toBe('visible');
  });

  it('an absolute dropdown inside the topbar is not clipped', () => {
    const d = declarations('.nb-topbar');
    expect(clipsAbsoluteDropdown(d)).toBe(false);
    // Fixture: a 52px-tall topbar (padding 12+12 plus a line of title) with a 200px
    // menu positioned at top:100% (absolute, below the bar).
    const fixture = {
      topbarHeight: 52,
      dropdownTop: 52,
      dropdownHeight: 200,
      overflowY: computedOverflow(d).y,
    };
    expect(dropdownClippedPx(fixture)).toBe(0);
    // Control: the same menu would be fully clipped if overflow-x:auto had forced overflow-y:auto.
    expect(dropdownClippedPx({ ...fixture, overflowY: 'auto' })).toBe(200);
    expect(clipsAbsoluteDropdown({ ...d, 'overflow-x': 'auto' })).toBe(true);
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
      maxWidth100: false, boxSizingBorderBox: false, overflowWrapAnywhere: false,
    });
    expect(before.headerBox).toBe(508);
    // The report recorded 119 px of sideways scroll (508 − 390 = 118; 1 px of subpixel/rounding).
    expect(before.pageOverflow).toBe(118);
    const after = topbarOnAPhone({
      viewport, titleContent, paddingInline,
      maxWidth100: true, boxSizingBorderBox: true, overflowWrapAnywhere: true,
    });
    expect(after.headerBox).toBe(390);
    expect(after.pageOverflow).toBe(0);
    // Without box-sizing: border-box, max-width: 100% would still let padding spill past the screen.
    const noBorderBox = topbarOnAPhone({
      viewport, titleContent, paddingInline,
      maxWidth100: true, boxSizingBorderBox: false, overflowWrapAnywhere: true,
    });
    expect(noBorderBox.headerBox).toBe(430);
    expect(noBorderBox.pageOverflow).toBe(40);
    // overflow-x:auto is not modelled as a way to make the page fit — that token is the defect.
  });

  it('a workspace still holding the kit as it was before this fix is still recognised as OUR starter', () => {
    const before = DESIGN_KIT_CSS
      .replace(/\/\* A dashboard topbar holds the page title[\s\S]*?\*\/\n/, '')
      .replace(NEW_TOPBAR, OLD_TOPBAR);
    expect(before).not.toBe(DESIGN_KIT_CSS);
    expect(before).toContain(OLD_TOPBAR);
    expect(isKnownSeedVersion('src/index.css', before)).toBe(true);
    expect(isKnownSeedVersion('src/index.css', DESIGN_KIT_CSS)).toBe(true);
    // The first PR head shipped overflow-x:auto with its original comment; that starter
    // must stay recognisable too (seed history is add-only). Reconstruct both.
    const firstPrComment = `/* A dashboard topbar holds the page title (autopsy BR1972: "EDU AI – EXAMINATION ASSISTANT"
   made this header 508px wide on a 390px phone, because a flex item's min-width is its
   content size). It may shrink and wrap, and a long title scrolls inside the bar instead
   of widening the page. Existing apps that already copied the previous rule are not rewritten. */
`;
    const firstPr = DESIGN_KIT_CSS
      .replace(/\/\* A dashboard topbar holds the page title[\s\S]*?\*\/\n/, firstPrComment)
      .replace(NEW_TOPBAR, FIRST_PR_TOPBAR);
    expect(firstPr).not.toBe(DESIGN_KIT_CSS);
    expect(firstPr).toContain(FIRST_PR_TOPBAR);
    expect(firstPr).toContain('scrolls inside the bar');
    expect(isKnownSeedVersion('src/index.css', firstPr)).toBe(true);
  });
});
