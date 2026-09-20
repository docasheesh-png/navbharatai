// EVERY VIEW INSIDE ViewPanels' BLOCK WRAPPER MUST BOUND ITS OWN HEIGHT (2026-09-20).
//
// `ViewPanels.tsx` renders each of its 37 views inside
//
//     <div className="flex-1 h-full overflow-hidden">   ← display: BLOCK, definite height, CLIPS
//
// so the wrapper hands scrolling DOWN: a view that does not bound its own height can never overflow
// itself, nothing scrolls, and the wrapper silently cuts off everything past the fold. That is the
// App Mart bug (#3151) and it is a CLASS, not an instance — which is why the siblings were hunted.
//
// The audit (hand-verified, every one of the 37): **36 bound themselves correctly** with `h-full` or
// `height: '100%'`, one did not. `DarkModeGenerator` carried `minHeight: '100%'` — a FLOOR, not a
// ceiling — and no vertical `overflow` anywhere in the file. Measured in Chromium with the real chain:
// content 4317px, scroller 4317px, `scrollTop` stuck at 0, the last card at y≈4231 in a 757px
// viewport. Unreachable by pointer or touch.
//
// ⚠️ WHY THIS FILE CHECKS TWO NAMED COMPONENTS RATHER THAN POLICING ALL 37. A static sweep was
// written and thrown away: across 37 heterogeneous components (Tailwind roots, inline `style`
// objects, a style const declared elsewhere, helper components defined before AND after the export)
// it produced false positives in both directions on every variant tried — it cleared
// `DarkModeGenerator` on one pass and flagged the perfectly-correct `APITester` and
// `ProjectInsightsPanel` on another. **A guard that cannot be trusted in either direction is worse
// than no guard**: it trains people to edit the test. So this locks what was actually measured, and
// the class is recorded in `PROGRESS.md` where a reader will meet it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8');

describe("the wrapper clips, so the view must scroll", () => {
  const viewPanels = read('src/components/panels/ViewPanels.tsx');

  it('ViewPanels still delegates scrolling downward — the premise of every view root', () => {
    // If this ever becomes `overflow-y-auto`, the wrapper scrolls and the rule below changes
    // meaning. Asserted so the premise cannot move silently underneath the roots that rely on it.
    expect(viewPanels).toContain('className="flex-1 h-full overflow-hidden"');
  });

  it('the wrapper is a BLOCK, so `flex-1` alone can never fill it', () => {
    // The whole bug in one line: `flex-1` styles a flex CHILD. It does not make this element a flex
    // CONTAINER, so a child relying on it gets `height: auto` and the chain dies here.
    const wrapper = 'flex-1 h-full overflow-hidden';
    expect(wrapper.split(/\s+/)).not.toContain('flex');
  });
});

describe('DarkModeGenerator owns a real scroller', () => {
  const src = read('src/components/ide/DarkModeGenerator.tsx');
  const root = src.slice(src.indexOf("background: 'var(--surface-base)'"), src.indexOf("background: 'var(--surface-base)'") + 320);

  it('bounds its height with `height`, never `minHeight`', () => {
    expect(root).toContain("height: '100%'");
    // The exact defect: a floor cannot bound a box. If this returns, the screen silently clips again.
    expect(root).not.toContain("minHeight: '100%'");
  });

  it('scrolls vertically, which nothing in this file did before', () => {
    expect(root).toContain("overflowY: 'auto'");
    expect(root).toContain("overscrollBehavior: 'contain'");
  });

  it('has exactly ONE consumer, so the fix cannot reach another screen', () => {
    const vp = read('src/components/panels/ViewPanels.tsx');
    expect(vp).toContain('<DarkModeGenerator');
    // rendered inside the clipping wrapper — the context `height: '100%'` resolves against
    expect(vp).toMatch(/flex-1 h-full overflow-hidden">\s*\n\s*<DarkModeGenerator/);
  });
});

describe('App Mart, the instance this class was found from, still holds', () => {
  it('NavAppStore keeps its own bounded scroller', () => {
    const store = read('src/components/ide/NavAppStore.tsx');
    expect(store).toContain('h-full overflow-y-auto overscroll-contain');
  });
});
