/**
 * EVERY POPUP MUST CLEAR THE APP'S OWN CHROME — the header, the notch, and the bottom tab bar.
 *
 * 🔴 Admin, 2026-09-22: *"navbharatai me bahut se popup hai, jo crop ho rahe hai header se ya footer
 * se … aise crop hone wale sabhi popup dhund ke fix karna hai."*
 *
 * ## What was measured, before anything was changed
 *
 * All 44 dialogs in the client were rendered against the REAL built stylesheet at 3 phone widths ×
 * 3 notch depths, with a short card and a long one, and three numbers were taken each time: how far
 * the card went under the notch, under the tab bar, and off the bottom of the screen.
 *
 *     44 dialogs · 18 carried the contract · 26 did not
 *
 * **The contract already existed and was already correct** (`index.css`): `nb-sheet-overlay` /
 * `-flush` on the fixed backdrop subtract the three things a dialog cannot see for itself — the
 * browser toolbar (`dvh`), the device insets (`env()`) and the app's own bottom bar
 * (`--nb-bottom-nav`, `fixed bottom-0` at z-150, which paints over everything below it) — and
 * `nb-sheet` / `nb-sheet-partial` cap the card at the room the overlay really has. The bug was
 * never the contract. It was that most dialogs did not use it.
 *
 * ## 🔴 The one that is worth remembering: the contract was CANCELLED in place
 *
 * `NavAppStore`'s two sheets carried `nb-sheet-overlay-flush` **and** `p-0` on the same element.
 * Tailwind emits utilities after components and both are one class of specificity, so `p-0` won on
 * source order: the measured `padding-bottom` was **0px**. The protection was written, reviewed,
 * visible in the class list, and did nothing — and nothing anywhere failed. The sheet sat 90px
 * under the tab bar for every user, with a short dialog, on every phone size.
 *
 * That is why `noPaddingUtilityCancelsTheContract` below is absolute rather than ratcheted: there
 * are zero violations now, and a class that silently disables a protection is exactly the kind of
 * thing a baseline would let drift back in.
 *
 * ## 🔑 Why 24 dialogs could accumulate beside TWO existing guards
 *
 * This repo already had two sheet tests, and both are good: `sheetOverlayGeometry.test.ts` pairs a
 * dialog's z-index with the right reservation, and `theSheetOpensOverTheScreenNotInsideAFooter
 * .test.ts` makes a sheet portal to the body. **Both select their subjects by the PRESENCE of
 * `nb-sheet-overlay`.** So a dialog that never adopted the class was invisible to both of them —
 * the one population that most needed checking was the one no check could see. That is the gap
 * this file closes, and it restates neither of their rules.
 *
 * ⚠️ They also caught this change twice, which is the reason they are named here. Adding the class
 * to ReportNoteDialog and BuiltAppsPanel made both visible to the portal test for the first time
 * — and neither portalled, a real trap of its own (an ancestor with a transform or a blur becomes
 * the containing block for `position: fixed`). And an early draft reasoned that ReportNoteDialog's
 * z-150 sat UNDER the bar; once portalled it is appended after the app root and paints OVER it at
 * equal z, which is exactly the `z ≥ 150 ⇒ nb-sheet-over-nav` rule the geometry test enforces.
 *
 * ## Why the rest is a RATCHET and not a hard failure
 *
 * 21 dialogs still do not carry the contract. Failing CI on all of them would be red on day one and
 * switched off within a week — so the count per file is recorded and may only go DOWN, which is the
 * pattern `themeColourBaseline` already uses in this repo for the same reason. A NEW dialog cannot
 * skip the contract at all, because a file not in the baseline has a baseline of zero.
 *
 * ⚠️ What this file deliberately does NOT assert: that a dialog RENDERS clear of the chrome. jsdom
 * has no layout. That was established by the measurement above and re-measured after the fixes
 * (26 → 21, each of the five confirmed at all nine combinations); a unit test pretending to repeat
 * it would be worse than this one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanDialogs, BASELINE } from '../scripts/sheetContractBaseline.mjs';

const root = resolve(__dirname, '..');
const dialogs = scanDialogs(root);
const baseline: Record<string, number> = JSON.parse(readFileSync(resolve(root, BASELINE), 'utf8'));

describe('the contract itself is still there to be used', () => {
  // If these classes are ever renamed or dropped, every assertion below becomes vacuous — it would
  // be asserting that files carry a class that no longer does anything.
  const css = readFileSync(resolve(root, 'src/index.css'), 'utf8');
  it('index.css still defines the overlay and the card halves', () => {
    for (const rule of ['.nb-sheet-overlay', '.nb-sheet-overlay-flush', '.nb-sheet-over-nav', '.nb-sheet', '.nb-sheet-partial']) {
      expect(css, `${rule} is gone from index.css`).toContain(`${rule} {`);
    }
  });

  it('…and it really subtracts the tab bar, which is the subtraction CSS cannot infer', () => {
    // `dvh` and `env()` a browser can work out for itself. The app's own bar it cannot.
    const overlay = css.slice(css.indexOf('.nb-sheet-overlay {'));
    expect(overlay.slice(0, 400)).toContain('--nb-bottom-nav');
  });

  it('the scan finds dialogs at all (a scan that found none would pass everything)', () => {
    expect(dialogs.length).toBeGreaterThan(30);
    expect(dialogs.filter((d) => d.hasContract).length).toBeGreaterThan(10);
  });
});

describe('🔴 a padding utility may never cancel the contract', () => {
  it('no overlay carries both the contract and an unconditional p-* utility', () => {
    const cancelled = dialogs.filter((d) => d.hasContract && d.cancelling.length > 0);
    expect(
      cancelled.map((d) => `${d.file}:${d.line} → ${d.cancelling.join(' ')}`),
      'These overlays carry the sheet contract AND a padding utility that overrides it. Tailwind ' +
        'emits utilities after components, so the utility wins and every reserve silently becomes ' +
        'zero — the sheet then rests under the notch or the tab bar with nothing failing. Remove ' +
        'the utility (a responsive one like `sm:p-4` is fine: at that width the bar is not rendered ' +
        'and the insets are zero).',
    ).toEqual([]);
  });
});

describe('the ratchet — a dialog without the contract can only ever leave the list', () => {
  const counts: Record<string, number> = {};
  for (const d of dialogs.filter((x) => !x.hasContract)) counts[d.file] = (counts[d.file] ?? 0) + 1;

  it('no file has MORE uncovered dialogs than its baseline', () => {
    const worse: string[] = [];
    for (const [file, n] of Object.entries(counts)) {
      const was = baseline[file] ?? 0;
      if (n > was) worse.push(`${file}: now ${n}, baseline ${was}`);
    }
    expect(
      worse,
      'A new dialog skipped the sheet contract. Put `nb-sheet-overlay` (or `-flush` for an ' +
        'edge-to-edge phone sheet) on the fixed backdrop and `nb-sheet` on the card — and add ' +
        '`nb-sheet-over-nav` when its z-index is ABOVE the tab bar\'s 150, so it does not hold a ' +
        'strip for a bar it already covers.',
    ).toEqual([]);
  });

  it('no file has FEWER than its baseline — an improvement is locked in the moment it lands', () => {
    const better: string[] = [];
    for (const [file, was] of Object.entries(baseline)) {
      const n = counts[file] ?? 0;
      if (n < was) better.push(`${file}: now ${n}, baseline ${was}`);
    }
    expect(
      better,
      'Fewer uncovered dialogs than the baseline — good. Lock it in so it cannot creep back: ' +
        'node scripts/sheetContractBaseline.mjs --write, then commit tests/fixtures/sheetContractBaseline.json.',
    ).toEqual([]);
  });
});

describe('the five that cropped with a SHORT dialog are fixed', () => {
  // These cropped for every user, whatever their content — measured before the fix and again
  // after. Named explicitly because a ratchet alone would let one of them regress back to its
  // baseline number without anybody noticing which one it was.
  const fixed = [
    ['src/components/ReportSheet.tsx', 'nb-sheet-overlay-flush nb-sheet-over-nav'],
    ['src/components/agentv3/ReportNoteDialog.tsx', 'nb-sheet-overlay-flush nb-sheet-over-nav'],
    ['src/components/ide/NavAppStore.tsx', 'nb-sheet-overlay-flush'],
    ['src/components/admin/BuiltAppsPanel.tsx', 'nb-sheet-overlay nb-sheet-over-nav'],
  ] as const;

  for (const [file, needs] of fixed) {
    it(`${file.split('/').pop()} carries ${needs}`, () => {
      expect(readFileSync(resolve(root, file), 'utf8')).toContain(needs);
    });
  }

  it('ReportSheet no longer pads the inset twice', () => {
    // The overlay reserves the home indicator now; the card used to do it as well, which would
    // have left a double gap under the buttons.
    const src = readFileSync(resolve(root, 'src/components/ReportSheet.tsx'), 'utf8');
    expect(src).not.toContain("paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))'");
  });

  it('the two bare viewport fractions became clamped caps', () => {
    // ⚠️ Asserted against the CLASS LISTS, not the file text — both fixes explain themselves in a
    // comment that names the fraction they removed, and a plain `toContain` matched the comment.
    // Caught by this test failing on its own change; the wording stays because it is the reason.
    const classesIn = (file: string) =>
      [...readFileSync(resolve(root, file), 'utf8').matchAll(/className=(?:\{[`"]|["`])([^"`]*)/g)]
        .map((m) => m[1]).join(' ');
    expect(classesIn('src/components/agentv3/ReportNoteDialog.tsx')).not.toContain('max-h-[85vh]');
    expect(classesIn('src/components/admin/BuiltAppsPanel.tsx')).not.toContain('h-[88vh]');
    // and the replacements are really there
    expect(classesIn('src/components/agentv3/ReportNoteDialog.tsx')).toContain('nb-sheet-partial');
    expect(classesIn('src/components/admin/BuiltAppsPanel.tsx')).toContain('nb-sheet');
  });
});
