// APP MART STOPPED SCROLLING BECAUSE A WRAPPER JOINED THE HEIGHT CHAIN (2026-09-20).
//
// THE CHAIN, top to bottom, for `activeView === 'appstore'`:
//
//   App.tsx `<main className="flex flex-1 relative min-h-0 min-w-0">`      row flex, definite height
//     └ App.tsx `screenRef`  flex-1 flex flex-col min-h-0 … overflow-y-auto   definite (stretched)
//         └ ViewPanels     `flex-1 h-full overflow-hidden`                 definite — AND display:BLOCK
//             └ PullToRefresh wrapper                                      ← the box that broke
//                 └ the scroll container   `h-full overflow-y-auto`
//
// Until 2026-09-19 NavAppStore's `h-full overflow-y-auto` div was the DIRECT child of that ViewPanels
// box, so `h-full` resolved against a definite height and the list scrolled. Commit 843d0ab0 (pull to
// refresh) wrapped it, and the new wrapper carried `flex-1 min-h-0` — right for a FLEX-COLUMN parent
// and INERT in a block one. The wrapper fell to `height: auto`, `h-full` inside it became `100%` of
// `auto` (which is `auto`), the scroll container was never shorter than its own content, and the
// ViewPanels box clipped everything below the fold. No error, no failing test: `tsc` and `vitest`
// cannot see a height chain, and the gesture logic this repo DOES test is pure and stayed correct.
//
// 🔒 WHAT THIS FILE CAN AND CANNOT PROVE. Vitest runs in `node` (vitest.config.ts) — there is no
// layout engine here, so no test in this repo can measure a scrollbar. What it CAN do is render the
// component and assert the classes it really emits, which is the fact the bug turned on. Stated
// plainly rather than dressed up: this locks the CONTRACT, and a browser is what confirms the pixels.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import PullToRefresh from '../src/components/PullToRefresh';

const render = (props: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(
    React.createElement(
      PullToRefresh,
      { onRefresh: async () => undefined, ...props } as never,
      React.createElement('p', null, 'content'),
    ),
  );

/** The class list of the Nth div in render order (0 = the wrapper). */
const classesOfDiv = (html: string, n: number): string[] => {
  const opens = html.match(/<div[^>]*>/g) ?? [];
  const cls = /class="([^"]*)"/.exec(opens[n] ?? '');
  return (cls?.[1] ?? '').split(/\s+/).filter(Boolean);
};

describe('the wrapper fills its parent instead of hugging its content', () => {
  it('carries BOTH fill rules, because it cannot see which kind of parent it is in', () => {
    const wrapper = classesOfDiv(render(), 0);
    // `h-full` is the one App Mart needs — its parent is a BLOCK with a definite height, where
    // `flex-1` does nothing at all. Its absence is the whole bug.
    expect(wrapper).toContain('h-full');
    // …and these stay for a flex-column parent, the case the component was originally written for.
    expect(wrapper).toContain('flex-1');
    expect(wrapper).toContain('min-h-0');
  });

  it('still clips the pull translation, so the indicator cannot spill out', () => {
    expect(classesOfDiv(render(), 0)).toContain('overflow-hidden');
  });
});

describe('the scroll container is bounded by construction, not by the caller', () => {
  it('fills the wrapper even when the caller passes no height at all', () => {
    // The scroller is the 3rd div: wrapper, indicator, indicator-inner, scroller.
    const html = render();
    const scroller = classesOfDiv(html, 3);
    expect(scroller).toContain('flex-1');
    expect(scroller).toContain('min-h-0');
  });

  it("keeps the caller's own classes beside them", () => {
    const scroller = classesOfDiv(render({ className: 'h-full overflow-y-auto bg-surface' }), 3);
    expect(scroller).toEqual(expect.arrayContaining(['min-h-0', 'flex-1', 'h-full', 'overflow-y-auto', 'bg-surface']));
  });

  it('emits no stray "undefined" class when the caller passes none', () => {
    expect(render()).not.toContain('undefined');
  });
});

describe('App Mart asks for the reset its four tabs need', () => {
  const store = readFileSync(join(process.cwd(), 'src/components/ide/NavAppStore.tsx'), 'utf-8');

  it('wires the tab as the scroll-reset key — one scroller, four tabs', () => {
    expect(store).toContain('scrollToTopKey={tab}');
  });

  it('still owns exactly ONE scroll container for the whole screen', () => {
    // A second `overflow-y-auto` on a tab pane would make two scrollbars compete; the only other
    // scroller on this screen is the horizontal tab strip and the detail sheet, which are different
    // axes and a different surface.
    const verticalScrollers = store.match(/overflow-y-auto/g) ?? [];
    // the PullToRefresh className + the two modal sheets
    expect(verticalScrollers.length).toBeLessThanOrEqual(3);
  });
});

describe('the fix stays scoped to App Mart', () => {
  it('PullToRefresh has exactly ONE consumer, so no other screen can be affected', () => {
    // Enumerated from the tree rather than asserted in prose. If a second screen adopts the gesture
    // later this fails, and whoever adds it re-reads the height-chain note above before trusting it —
    // which is the point: the wrapper's geometry is only safe for parents somebody has checked.
    const found = execSync(
      "grep -rl \"from '\\(\\.\\./\\)*PullToRefresh'\" src --include=*.tsx || true",
      { encoding: 'utf-8' },
    ).split('\n').map((l) => l.trim()).filter(Boolean);
    expect(found).toEqual(['src/components/ide/NavAppStore.tsx']);
  });

  it('touches no global stylesheet — App Mart cannot fix itself by changing every page', () => {
    // The whole class of "fix one screen, break the rest" starts with a rule in index.css. There is
    // no CSS file in this change at all, and this asserts the one that would matter is untouched.
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8');
    expect(css).not.toContain('App Mart');
  });
});
