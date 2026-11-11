// Autopsy BR1975 (2026-11-11). "Give me one one website code for name satyam
// engineering works" succeeded, but opened at 390×844 the page scrolled SIDEWAYS
// by 260 px: <nav> "Home Services About Contact" was 296 px wide, reaching 650 px,
// beside the long company name, and three links were 24 px tall. The kit already
// wraps .nb-header / .nb-topbar / .nb-header-actions (BR1959, BR1972), but this
// build used a bare <header> and <nav>, so those class rules never applied.
// The kit is fixed once, for every app built from it, with zero-specificity
// :where(header) rules. Existing apps that already copied a previous rule are
// not rewritten (only new kit copies, and kitRestore of a *dropped* current
// rule). Chromium headless on this box hangs, so these fixtures are CSS
// declarations plus a 390×844 geometry model, not a live Playwright pass.
//
// Two-sided vs origin/main 7a06f2ee: the .nb-topbar / .nb-header-actions wrap
// rules stay as they are (main's phone-fit behaviour is not rewritten). A bare
// <header> + <nav> that main left overflowing now wraps. A block hero <header>
// is not given display:flex (flex-wrap is ignored on a non-flex box). overflow
// stays visible (BR1972: overflow-x:auto clips dropdowns). overflow-wrap is
// not set on the container (anywhere is inherited and breaks title words).

import { describe, it, expect } from 'vitest';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { isKnownSeedVersion } from '../src/server/AgentV3/seedVersions';

const HEADER_RULE =
  ':where(header) { flex-wrap: wrap; min-width: 0; max-width: 100%; box-sizing: border-box; }';
const NAV_RULE =
  ':where(header) nav { display: flex; flex-wrap: wrap; align-items: center; min-width: 0; max-width: 100%; }';
const LINK_RULE =
  ':where(header) nav a { display: inline-flex; align-items: center; min-height: 32px; }';

function declarations(selector: string): Record<string, string> {
  const needle = `\n${selector} {`;
  const at = DESIGN_KIT_CSS.indexOf(needle);
  expect(at, `${selector} is in the kit`).toBeGreaterThan(-1);
  const body = DESIGN_KIT_CSS.slice(DESIGN_KIT_CSS.indexOf('{', at) + 1, DESIGN_KIT_CSS.indexOf('}', at));
  return Object.fromEntries(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
}

function withoutMarketingHeaderRules(css: string): string {
  return css
    .replace(/\/\* A marketing-site <header>[\s\S]*?\*\/\n/, '')
    .replace(`${HEADER_RULE}\n`, '')
    .replace(`${NAV_RULE}\n`, '')
    .replace(`${LINK_RULE}\n`, '');
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

/**
 * Geometry of this report's header: a nowrap flex row whose <nav> is 296 px
 * wide and whose right edge reaches 650 px on a 390 px phone (260 px overflow).
 * The prefix (brand + gap + left padding) is therefore 650 - 296 = 354 px.
 */
function marketingHeaderOnAPhone(opts: {
  viewport: number;
  prefixWidth: number;
  navContent: number;
  flexWrap: boolean;
  headerMaxWidth100: boolean;
  navFlexWrap: boolean;
}): { rowWidth: number; pageOverflow: number } {
  let navUsed = opts.navContent;
  if (opts.navFlexWrap && opts.navContent > opts.viewport) {
    navUsed = opts.viewport;
  }
  let rowWidth: number;
  if (opts.flexWrap && opts.prefixWidth + navUsed > opts.viewport) {
    rowWidth = Math.max(opts.prefixWidth, navUsed);
  } else {
    rowWidth = opts.prefixWidth + navUsed;
  }
  // max-width: 100% caps the header's used box, but overflow stays visible
  // (BR1972: overflow-x:auto clips dropdowns). Descendants that stick out
  // still paint and widen the page, so headerMaxWidth100 must not hide
  // sideways scroll here. flex-wrap (or a nav that is itself narrower
  // than the phone) is what removes this report's 260px overflow.
  void opts.headerMaxWidth100;
  return { rowWidth, pageOverflow: Math.max(0, rowWidth - opts.viewport) };
}

function flagsFromCss(): {
  flexWrap: boolean;
  headerMaxWidth100: boolean;
  navFlexWrap: boolean;
} {
  const header = declarations(':where(header)');
  const nav = declarations(':where(header) nav');
  return {
    flexWrap: header['flex-wrap'] === 'wrap',
    headerMaxWidth100: header['max-width'] === '100%',
    navFlexWrap: nav['flex-wrap'] === 'wrap' && nav.display === 'flex',
  };
}

describe('a marketing-site header nav fits a phone', () => {
  it(':where(header) wraps and may shrink, without becoming a flex or scroll box', () => {
    const d = declarations(':where(header)');
    expect(d['flex-wrap']).toBe('wrap');
    expect(d['min-width']).toBe('0');
    expect(d['max-width']).toBe('100%');
    expect(d['box-sizing']).toBe('border-box');
    expect(d.display).toBeUndefined();
    expect(d['overflow-wrap']).toBeUndefined();
    expect(d.overflow).toBeUndefined();
    expect(d['overflow-x']).toBeUndefined();
    expect(d['overflow-y']).toBeUndefined();
    expect(computedOverflow(d)).toEqual({ x: 'visible', y: 'visible' });
  });

  it(':where(header) nav wraps its links inside the screen', () => {
    const d = declarations(':where(header) nav');
    expect(d.display).toBe('flex');
    expect(d['flex-wrap']).toBe('wrap');
    expect(d['min-width']).toBe('0');
    expect(d['max-width']).toBe('100%');
    expect(d.overflow).toBeUndefined();
    expect(computedOverflow(d)).toEqual({ x: 'visible', y: 'visible' });
  });

  it(':where(header) nav a meets the 32px tap-target floor', () => {
    const d = declarations(':where(header) nav a');
    expect(d.display).toBe('inline-flex');
    expect(d['align-items']).toBe('center');
    expect(d['min-height']).toBe('32px');
  });

  it('does not rewrite the kit classes origin/main already wraps', () => {
    // Two-sided: BR1959 / BR1972 behaviour on origin/main is kept.
    expect(declarations('.nb-header-actions')['flex-wrap']).toBe('wrap');
    expect(declarations('.nb-header-actions')['max-width']).toBe('100%');
    expect(declarations('.nb-topbar')['flex-wrap']).toBe('wrap');
    expect(declarations('.nb-topbar')['max-width']).toBe('100%');
    expect(declarations('.nb-topbar h1')['overflow-wrap']).toBe('break-word');
  });

  it('this report\'s 650px header no longer widens a 390px phone, and origin/main still would', () => {
    const viewport = 390;
    const navContent = 296;
    const prefixWidth = 650 - 296;
    const css = flagsFromCss();
    expect(css.flexWrap).toBe(true);
    expect(css.headerMaxWidth100).toBe(true);
    const now = marketingHeaderOnAPhone({
      viewport,
      prefixWidth,
      navContent,
      ...css,
    });
    expect(now.rowWidth).toBe(354);
    expect(now.pageOverflow).toBe(0);

    const onMain = marketingHeaderOnAPhone({
      viewport,
      prefixWidth,
      navContent,
      flexWrap: false,
      headerMaxWidth100: false,
      navFlexWrap: false,
    });
    expect(onMain.rowWidth).toBe(650);
    expect(onMain.pageOverflow).toBe(260);

    // Two-sided: dropping flex-wrap while leaving max-width:100% and a
    // wrapping nav (296px < 390px) still paints a 650px row, because
    // visible overflow is not clipped by max-width.
    const wrapDropped = marketingHeaderOnAPhone({
      viewport,
      prefixWidth,
      navContent,
      flexWrap: false,
      headerMaxWidth100: true,
      navFlexWrap: true,
    });
    expect(wrapDropped.rowWidth).toBe(650);
    expect(wrapDropped.pageOverflow).toBe(260);
  });

  it('a block hero header is not turned into a flex row', () => {
    expect(DESIGN_KIT_CSS).toContain(HEADER_RULE);
    expect(declarations(':where(header)').display).toBeUndefined();
    // A later, more specific `header { flex-wrap: nowrap }` still wins (:where is zero).
    expect(DESIGN_KIT_CSS).toContain(':where(header)');
    expect(DESIGN_KIT_CSS).not.toMatch(/(?<!:where\()header \{ flex-wrap: wrap/);
  });

  it('a workspace still holding the kit as it was before this fix is still recognised as OUR starter', () => {
    const before = withoutMarketingHeaderRules(DESIGN_KIT_CSS);
    expect(before).not.toBe(DESIGN_KIT_CSS);
    expect(before).not.toContain(HEADER_RULE);
    expect(before).not.toContain(NAV_RULE);
    expect(before).not.toContain(LINK_RULE);
    expect(isKnownSeedVersion('src/index.css', before)).toBe(true);
    expect(isKnownSeedVersion('src/index.css', DESIGN_KIT_CSS)).toBe(true);
  });
});
