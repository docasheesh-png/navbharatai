// Autopsy BR1975 (2026-11-11). "Give me one one website code for name satyam
// engineering works" succeeded, but opened at 390×844 the page scrolled SIDEWAYS
// by 260 px: <nav> "Home Services About Contact" was 296 px wide, reaching x=650,
// beside the long company name, and three links were 24 px tall.
//
// The delivered Header.tsx was:
//   <header className="nb-header">
//     <div className="container row justify-between items-center">
//       <div className="nb-brand"><h1/></div>
//       <nav>
//         <ul className="row gap-24">
//           <li><a/>...
// Brand and nav sit inside an inner nowrap .row, and the links sit in a nowrap
// ul.row. Wrapping <header> or <nav> does nothing to that tree (review of #4168
// at c201c6e6b). The kit now wraps those inner .row boxes — and the header's
// nav list — at phone widths only, at true zero specificity
// (`:where(.nb-header .row)` / `:where(.nb-header nav ul)`). display is not
// changed (.row is already flex). Game HUDs, card/article headers, desktop,
// stacked mobile-menu links, and the dark header palette are left as they are.
// Chromium headless on this box hangs, so these fixtures walk the real tree
// against the kit CSS plus this report's measured 296 px / x=650 geometry,
// not a live Playwright pass.
//
// Two-sided vs origin/main 7a06f2ee: .nb-header-actions / .nb-topbar /
// .nb-topbar h1 stay as they are. The same Header.tsx tree still overflows
// 260 px on main (and would with header/nav wrap alone). On this head it
// wraps at 390 px and does not wrap at 1024 px.

import { describe, it, expect } from 'vitest';
import { DESIGN_KIT_CSS, KIT_DARK_SWITCH } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { isKnownSeedVersion } from '../src/server/AgentV3/seedVersions';

const PHONE_MAX_WIDTH = 640;
const PHONE_MEDIA = `@media (max-width: ${PHONE_MAX_WIDTH}px)`;
const ROW_SELECTOR = '.nb-header .row';
const LIST_SELECTOR = '.nb-header nav ul';
const PHONE_WRAP_RULE =
  `:where(${ROW_SELECTOR}),\n  :where(${LIST_SELECTOR}) { flex-wrap: wrap; min-width: 0; max-width: 100%; }`;

const MARKETING_HEADER_COMMENT = /\/\* A site header \(\.nb-header\)[\s\S]*?\*\/\n/;
const MARKETING_HEADER_MEDIA =
  /@media \(max-width: 640px\) \{\n  :where\(\.nb-header \.row\),\n  :where\(\.nb-header nav ul\) \{ flex-wrap: wrap; min-width: 0; max-width: 100%; \}\n\}\n/;

function withoutMarketingHeaderRules(css: string): string {
  return css.replace(MARKETING_HEADER_COMMENT, '').replace(MARKETING_HEADER_MEDIA, '');
}

function declarations(selector: string): Record<string, string> {
  const needle = `\n${selector} {`;
  const at = DESIGN_KIT_CSS.indexOf(needle);
  expect(at, `${selector} is in the kit`).toBeGreaterThan(-1);
  const body = DESIGN_KIT_CSS.slice(DESIGN_KIT_CSS.indexOf('{', at) + 1, DESIGN_KIT_CSS.indexOf('}', at));
  return Object.fromEntries(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
}

function phoneMediaBody(css: string): string {
  const startNeedle = `${PHONE_MEDIA} {`;
  const start = css.indexOf(startNeedle);
  expect(start, 'phone media query is in the kit').toBeGreaterThan(-1);
  let i = start + startNeedle.length;
  let depth = 1;
  const from = i;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  return css.slice(from, i - 1);
}

function phoneWhereSelectors(css: string): string[] {
  return [...phoneMediaBody(css).matchAll(/:where\(([^)]+)\)/g)].map((m) => m[1]);
}

type El = { tag: string; className: string };

function hasClass(className: string, token: string): boolean {
  return className.split(/\s+/).filter(Boolean).includes(token);
}

function matchesSimple(el: El, simple: string): boolean {
  const tagMatch = simple.match(/^[a-z][\w-]*/i);
  const tag = tagMatch ? tagMatch[0] : null;
  const classes = [...simple.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  if (tag && el.tag !== tag) return false;
  return classes.every((c) => hasClass(el.className, c));
}

/** `ancestors` is root-first. */
function matchesDescendant(node: El & { ancestors: El[] }, selector: string): boolean {
  const parts = selector.trim().split(/\s+/);
  const subject = parts[parts.length - 1]!;
  const ancestorParts = parts.slice(0, -1);
  if (!matchesSimple(node, subject)) return false;
  let idx = 0;
  for (const part of ancestorParts) {
    while (idx < node.ancestors.length && !matchesSimple(node.ancestors[idx]!, part)) idx += 1;
    if (idx >= node.ancestors.length) return false;
    idx += 1;
  }
  return true;
}

function phoneRuleMatches(css: string, node: El & { ancestors: El[] }): boolean {
  return phoneWhereSelectors(css).some((sel) => matchesDescendant(node, sel));
}

function wrapAppliesAt(css: string, node: El & { ancestors: El[] }, viewport: number): boolean {
  if (!css.includes(PHONE_MEDIA) || viewport > PHONE_MAX_WIDTH) return false;
  if (!/flex-wrap:\s*wrap/.test(phoneMediaBody(css))) return false;
  return phoneRuleMatches(css, node);
}

/**
 * Faithful geometry of this report's Header.tsx tree:
 *   header.nb-header
 *     div.container.row          ← brand | nav (the overflowing nowrap flex row)
 *       div.nb-brand > h1
 *       nav
 *         ul.row.gap-24          ← the 296 px link list
 * Wrapping <header> or <nav> cannot split brand from nav: each has one child.
 * The page's painted right edge was x=650 (nav 296 px wide, so the prefix
 * to the nav's left edge is 650 - 296 = 354 px).
 */
function layoutReportHeader(opts: {
  viewport: number;
  innerRowWraps: boolean;
  navListWraps: boolean;
  prefixWidth: number;
  navContent: number;
}): { paintedRight: number; pageOverflow: number } {
  let navUsed = opts.navContent;
  if (opts.navListWraps && opts.navContent > opts.viewport) {
    navUsed = opts.viewport;
  }
  const paintedRight = opts.innerRowWraps && opts.prefixWidth + navUsed > opts.viewport
    ? Math.max(opts.prefixWidth, navUsed)
    : opts.prefixWidth + navUsed;
  return { paintedRight, pageOverflow: Math.max(0, paintedRight - opts.viewport) };
}

const header: El = { tag: 'header', className: 'nb-header' };
const innerRow: El & { ancestors: El[] } = {
  tag: 'div',
  className: 'container row justify-between items-center',
  ancestors: [header],
};
const nav: El = { tag: 'nav', className: '' };
const navList: El & { ancestors: El[] } = {
  tag: 'ul',
  className: 'row gap-24',
  ancestors: [header, innerRow, nav],
};
const reportLink: El & { ancestors: El[] } = {
  tag: 'a',
  className: '',
  ancestors: [header, innerRow, nav, navList, { tag: 'li', className: '' }],
};

const gameHud: El = { tag: 'header', className: 'nb-game-hud' };
const gameHudRow: El & { ancestors: El[] } = {
  tag: 'div',
  className: 'row',
  ancestors: [gameHud],
};

const card: El = { tag: 'article', className: 'card' };
const cardHeader: El = { tag: 'header', className: '' };
const cardRow: El & { ancestors: El[] } = {
  tag: 'div',
  className: 'row',
  ancestors: [card, cardHeader],
};

const VIEWPORT_PHONE = 390;
const VIEWPORT_DESKTOP = 1024;
const NAV_CONTENT = 296;
const PREFIX_WIDTH = 650 - 296;

describe('a marketing-site header nav fits a phone', () => {
  it('wraps the real Header.tsx inner .row and nav list at phone widths, at zero specificity, without changing display', () => {
    expect(DESIGN_KIT_CSS).toContain(PHONE_MEDIA);
    expect(DESIGN_KIT_CSS).toContain(PHONE_WRAP_RULE);
    expect(DESIGN_KIT_CSS).toContain(`:where(${ROW_SELECTOR})`);
    expect(DESIGN_KIT_CSS).toContain(`:where(${LIST_SELECTOR})`);
    // Not the rejected (0,1,+) forms, and not the previous header/nav layer.
    expect(DESIGN_KIT_CSS).not.toMatch(/:where\(\.nb-header\)\s+\.row/);
    expect(DESIGN_KIT_CSS).not.toMatch(/:where\(\.nb-header\)\s+nav/);
    expect(DESIGN_KIT_CSS).not.toMatch(/:where\(header\)\s+nav/);
    expect(DESIGN_KIT_CSS).not.toMatch(/:where\(header\)\s*\{/);
    const body = phoneMediaBody(DESIGN_KIT_CSS);
    expect(body).not.toMatch(/display\s*:/);
    expect(body).not.toMatch(/overflow/);
    expect(body).not.toMatch(/background|color:|border/);
    const d = Object.fromEntries(
      body.slice(body.indexOf('{') + 1, body.indexOf('}')).split(';').map((part) => part.trim()).filter(Boolean)
        .map((part) => [part.slice(0, part.indexOf(':')).trim(), part.slice(part.indexOf(':') + 1).trim()]),
    );
    expect(d['flex-wrap']).toBe('wrap');
    expect(d['min-width']).toBe('0');
    expect(d['max-width']).toBe('100%');
    expect(d.display).toBeUndefined();
    // .row stays a flex box; we do not restyle elements that were not flex.
    // The kit writes ".row   {" (padded so the layout helpers line up).
    expect(DESIGN_KIT_CSS).toMatch(/\.row\s*\{[^}]*display:\s*flex/);
    expect(DESIGN_KIT_CSS).not.toMatch(/\.row\s*\{[^}]*flex-wrap/);
  });

  it('this report\'s Header.tsx tree no longer widens a 390px phone, and origin/main still would', () => {
    expect(wrapAppliesAt(DESIGN_KIT_CSS, innerRow, VIEWPORT_PHONE)).toBe(true);
    expect(wrapAppliesAt(DESIGN_KIT_CSS, navList, VIEWPORT_PHONE)).toBe(true);
    // Wrapping the <header> or the <nav> is not what this tree needs.
    expect(phoneRuleMatches(DESIGN_KIT_CSS, { ...header, ancestors: [] })).toBe(false);
    expect(phoneRuleMatches(DESIGN_KIT_CSS, { ...nav, ancestors: [header, innerRow] })).toBe(false);

    const now = layoutReportHeader({
      viewport: VIEWPORT_PHONE,
      innerRowWraps: wrapAppliesAt(DESIGN_KIT_CSS, innerRow, VIEWPORT_PHONE),
      navListWraps: wrapAppliesAt(DESIGN_KIT_CSS, navList, VIEWPORT_PHONE),
      prefixWidth: PREFIX_WIDTH,
      navContent: NAV_CONTENT,
    });
    expect(now.paintedRight).toBe(354);
    expect(now.pageOverflow).toBe(0);

    const onMain = layoutReportHeader({
      viewport: VIEWPORT_PHONE,
      innerRowWraps: false,
      navListWraps: false,
      prefixWidth: PREFIX_WIDTH,
      navContent: NAV_CONTENT,
    });
    expect(onMain.paintedRight).toBe(650);
    expect(onMain.pageOverflow).toBe(260);

    // The first #4168 head wrapped <header> and <nav> and still overflowed.
    const previousApproach = layoutReportHeader({
      viewport: VIEWPORT_PHONE,
      innerRowWraps: false,
      navListWraps: false,
      prefixWidth: PREFIX_WIDTH,
      navContent: NAV_CONTENT,
    });
    expect(previousApproach.pageOverflow).toBe(260);
  });

  it('does not wrap a game HUD or a card/article header', () => {
    expect(wrapAppliesAt(DESIGN_KIT_CSS, gameHudRow, VIEWPORT_PHONE)).toBe(false);
    expect(phoneRuleMatches(DESIGN_KIT_CSS, { ...gameHud, ancestors: [] })).toBe(false);
    expect(declarations('.nb-game-hud').display).toBe('flex');
    expect(declarations('.nb-game-hud')['flex-wrap']).toBeUndefined();
    expect(wrapAppliesAt(DESIGN_KIT_CSS, cardRow, VIEWPORT_PHONE)).toBe(false);
    expect(phoneRuleMatches(DESIGN_KIT_CSS, { tag: 'header', className: 'row', ancestors: [card] })).toBe(false);
  });

  it('leaves desktop unchanged', () => {
    expect(DESIGN_KIT_CSS).toContain(PHONE_MEDIA);
    const withoutPhone = DESIGN_KIT_CSS.replace(/@media \(max-width: 640px\) \{[\s\S]*?\n\}\n/, '');
    expect(withoutPhone).not.toContain(`:where(${ROW_SELECTOR})`);
    expect(withoutPhone).not.toContain(`:where(${LIST_SELECTOR})`);
    expect(wrapAppliesAt(DESIGN_KIT_CSS, innerRow, VIEWPORT_DESKTOP)).toBe(false);
    expect(wrapAppliesAt(DESIGN_KIT_CSS, navList, VIEWPORT_DESKTOP)).toBe(false);
    const desktop = layoutReportHeader({
      viewport: VIEWPORT_DESKTOP,
      innerRowWraps: false,
      navListWraps: false,
      prefixWidth: PREFIX_WIDTH,
      navContent: NAV_CONTENT,
    });
    expect(desktop.paintedRight).toBe(650);
    expect(desktop.pageOverflow).toBe(0);
  });

  it('does not change display on stacked mobile-menu links', () => {
    const body = phoneMediaBody(DESIGN_KIT_CSS);
    expect(body).not.toMatch(/display\s*:/);
    expect(DESIGN_KIT_CSS).not.toMatch(/nav a[^{]*\{[^}]*display\s*:/);
    expect(phoneRuleMatches(DESIGN_KIT_CSS, reportLink)).toBe(false);
    // An app rule `a { display: block }` is (0,0,1). We set no display on the
    // link, so that stacked mobile-menu rule still wins — unlike the previous
    // `:where(header) nav a` (0,0,2) `display: inline-flex`.
  });

  it('does not restyle a dark .nb-header', () => {
    const d = declarations('.nb-header');
    expect(d.background).toBe('color-mix(in srgb, var(--card) 90%, transparent)');
    expect(d.color).toBeUndefined();
    expect(d['border-bottom']).toBe('1px solid var(--border)');
    expect(phoneMediaBody(DESIGN_KIT_CSS)).not.toMatch(/background|color:|border/);
    expect(DESIGN_KIT_CSS).toContain(KIT_DARK_SWITCH);
  });

  it('does not rewrite the kit classes origin/main already wraps', () => {
    expect(declarations('.nb-header-actions')['flex-wrap']).toBe('wrap');
    expect(declarations('.nb-header-actions')['max-width']).toBe('100%');
    expect(declarations('.nb-topbar')['flex-wrap']).toBe('wrap');
    expect(declarations('.nb-topbar')['max-width']).toBe('100%');
    expect(declarations('.nb-topbar h1')['overflow-wrap']).toBe('break-word');
  });

  it('a workspace still holding the kit as it was before this fix is still recognised as OUR starter', () => {
    const before = withoutMarketingHeaderRules(DESIGN_KIT_CSS);
    expect(before).not.toBe(DESIGN_KIT_CSS);
    expect(before).not.toContain(`:where(${ROW_SELECTOR})`);
    expect(before).not.toContain(PHONE_WRAP_RULE);
    expect(isKnownSeedVersion('src/index.css', before)).toBe(true);
    expect(isKnownSeedVersion('src/index.css', DESIGN_KIT_CSS)).toBe(true);
  });
});
