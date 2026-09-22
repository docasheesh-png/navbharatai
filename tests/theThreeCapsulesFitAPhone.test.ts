import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THREE CAPSULES, ONE ROW, AND NOTHING CUT ON A 360px PHONE (admin 2026-09-22).
 *
 * The instruction: *"wallet and billing me all 3 options ko horizontal 3 capsule ke jaise banao!
 * (buy token) (token balance) (promocode credit) jisse ui clear hoga"*.
 *
 * 🔴 WHY THIS FILE EXISTS RATHER THAN "IT LOOKS FINE": three capsules on the smallest phone this
 * app serves is TIGHTER than the layout that already produced this panel's worst defect. The
 * capsule row's own source records it — four tiles in `grid-cols-2` once gave each ~160px and
 * truncated the balance to "89,894 tok…", *the one number the screen exists to show*. Three
 * capsules at 360px get ~104px each. So "it fits" is a MEASUREMENT, not an opinion, and every
 * property this file pins is one the measurement forced.
 *
 * WHAT WAS MEASURED, in a real Chromium against the REAL built stylesheet, at 360 / 390 / 414 /
 * 768px, with a five-digit AND a seven-digit balance, before this shipped:
 *
 *   • first draft  → 460px of content in 320px of row. The row scrolled; the third capsule sat
 *                    off the right edge, which is not "clear".
 *   • after the four width savings below → 308px in 320px. Row scrollWidth === clientWidth at
 *                    every width, and NOT ONE text node clipped, seven-digit balance included.
 *
 * ⚠️ `tsc` and `vitest` cannot measure a layout. So what is held here is the set of SOURCE
 * properties that produced the measured result — remove any one of them and the row stops fitting
 * on a phone, with nothing else in this repo failing. Each case names the millimetres it bought.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
/**
 * ⚠️ COMMENTS ARE STRIPPED, and that is load-bearing rather than tidy — the same trap the sibling
 * suite records. The capsule row's own notes quote `truncate` and `sr-only` while explaining why
 * neither belongs where it used to be, so an unstripped read makes those cases fail on the
 * explanation instead of on the code.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const PANEL = stripComments(read('src/components/panels/BillingPanel.tsx'));

/** The row, as code. The detail panel underneath is where the slice ends. */
const ROW_OPEN = '<div className="flex items-stretch gap-2 sm:gap-3 overflow-x-auto no-scrollbar';
const DETAIL_PANEL = 'bg-card border border-line rounded-[2.5rem] p-6 sm:p-8 shadow-3xl';
const row = (): string => {
  const from = PANEL.indexOf(ROW_OPEN);
  const to = PANEL.indexOf(DETAIL_PANEL, from);
  expect(from, 'the capsule row').toBeGreaterThan(-1);
  expect(to, 'the detail panel after it').toBeGreaterThan(from);
  return PANEL.slice(from, to);
};

describe('the row is a FLEX row, because a grid cell can truncate and a flex item need not', () => {
  it('every capsule is `flex-1 min-w-fit` — equal while they fit, never below their own content', () => {
    // `flex-1` alone would let a capsule shrink below its text; `min-w-fit` is the half that makes
    // a long value push the ROW into scrolling instead of the number being cut.
    expect(row().match(/flex-1 min-w-fit/g) ?? []).toHaveLength(3);
  });

  it('the row can scroll, so a value longer than anything measured still is not cut', () => {
    expect(row()).toContain('overflow-x-auto');
  });

  it('🔒 nothing in the row truncates — that is the defect this panel already paid for once', () => {
    expect(row()).not.toContain('truncate');
    expect(row()).not.toContain('text-ellipsis');
  });

  it('the three capsules still open the three tabs, and nothing else', () => {
    const block = row();
    for (const tab of ['purchase', 'remaining', 'gift']) {
      // Once for the click, once for Enter/Space — a capsule that lost either is half a control.
      expect(block.match(new RegExp(`onSetActiveBillingDetailTab\\('${tab}'\\)`, 'g')) ?? [],
        `the ${tab} capsule`).toHaveLength(2);
    }
  });
});

describe('🔴 the four width savings the measurement forced — each is worth real millimetres', () => {
  it('the ≈ ₹ figure is NOT in the balance capsule (it is in the tab the capsule opens)', () => {
    // ~60px, the single biggest saving. The rupee view of the same balance is shown in full in
    // the "remaining" tab directly underneath, so nothing became unreachable.
    const block = row();
    expect(block).toContain('wallet?.tokenBalance');
    expect(block, 'two views of one balance do not both fit on a phone').not.toContain('remaining_balance');
  });

  it('the icon chips stand down below `sm` — the widest thing in the row carrying no information', () => {
    // ~30px each. The LABEL says what the capsule is; the icon repeats it in a picture.
    expect(row().match(/hidden sm:inline-flex/g) ?? []).toHaveLength(3);
  });

  it('labels are sentence case on a phone and uppercase only from `sm`', () => {
    // ~12px each: uppercase is ~15% wider, and `tracking-widest` adds a pixel per character.
    // "PROMOCODE" does not fit a 104px capsule; "Promocode" does. (The label was "Promocode
    // credit" until the admin shortened it — *"promocode credit ka naam badal kar promocode
    // karo"* — which is what balanced the row at 96/100/100px instead of 80/99/117px.)
    const block = row();
    expect(block.match(/tracking-wide sm:uppercase sm:tracking-widest/g) ?? []).toHaveLength(3);
    expect(block, 'unconditional uppercase is what did not fit').not.toMatch(/font-extrabold uppercase/);
  });

  it('padding and gap are tighter on a phone and roomier from `sm`', () => {
    const block = row();
    expect(block.match(/gap-1\.5 sm:gap-2 rounded-full px-2\.5 sm:px-4/g) ?? []).toHaveLength(3);
  });
});

describe('🔴 two regressions the measurement caught before they shipped', () => {
  it('the low-balance dot is NOT inside the chip a phone hides', () => {
    // The dot is the whole point of `theRedDotLeadsToTheTopUp`. Drawn inside the icon chip it
    // vanished below `sm` — gone from every phone, which is where a ₹0 balance matters most.
    const block = row();
    const chip = block.slice(block.indexOf('hidden sm:inline-flex'), block.indexOf('</span>', block.indexOf('hidden sm:inline-flex')));
    expect(chip, 'a dot a phone cannot show').not.toContain('bg-danger');
    expect(block).toContain('absolute top-1.5 right-2 w-2 h-2 rounded-full bg-danger');
    expect(block, 'the dot needs the capsule as its positioning context').toMatch(/"relative flex-1 min-w-fit/);
  });

  it('the screen-reader words are a SIBLING of the chip, not a child of it', () => {
    // `sr-only` clips to 1px but keeps its full intrinsic width, and a row item sized by
    // `min-w-fit` counts that width. Inside the chip it pushed the capsule's fit-content out and
    // squeezed the visible label to 16px at 768px — measured, not theorised.
    const block = row();
    const chipAt = block.indexOf('hidden sm:inline-flex');
    const srAt = block.indexOf('sr-only');
    expect(srAt, 'the words must still be there for a screen reader').toBeGreaterThan(-1);
    const chipEnd = block.indexOf('</span>', chipAt);
    expect(srAt, 'sr-only inside the chip re-creates the desktop squeeze').toBeGreaterThan(chipEnd);
  });
});
