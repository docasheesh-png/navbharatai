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
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
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

describe('slice 2 — the two that still cropped once measured with their REAL content', () => {
  // Slice 2 re-measured the remaining dialogs with their ACTUAL content rather than a filled
  // harness, and most of the "latent" list turned out not to crop at all (see the next block).
  // These two did: ComponentLibrary's fixed 420px preview ran 44px under the tab bar and 13px under
  // a 59px notch at 320×568; VerifyPhoneSheet's Verify button sat in the home-indicator's gesture
  // zone. After: all combinations clean, and the desktop preview is still exactly 420px.
  it('ComponentLibrary carries the contract and still lets its preview be 420px where it fits', () => {
    const src = readFileSync(resolve(root, 'src/components/ide/ComponentLibrary.tsx'), 'utf8');
    expect(src).toContain('nb-sheet-overlay fixed inset-0 z-50');
    expect(src).toContain('nb-sheet relative rounded-2xl');
    // `height` + `min-h-0`, NOT `flex-1`: the card has no fixed height, so a flex-1 preview would
    // have nothing to fill and collapse to ~150px on every desktop.
    expect(src).toContain(`<div className="min-h-0" style={{ height: '420px'`);
  });

  it('VerifyPhoneSheet reserves the home indicator and does not cancel its own reserve', () => {
    const src = readFileSync(resolve(root, 'src/components/VerifyPhoneSheet.tsx'), 'utf8');
    expect(src).toContain('nb-sheet-overlay-flush nb-sheet-over-nav fixed inset-0 z-[400]');
  });
});

describe('slice 3 — the image lightbox was TWO copies, and its close button sat in the notch', () => {
  // The free chat (AIChat) and Doctor AI (SDAChat) each carried an identical lightbox — already
  // drifted (one faded in, one did not). Both hung the ✕ at `-top-3 -right-3`, 12px ABOVE the card,
  // and capped the card at a bare 92dvh: on a tall photo the card's top landed ~34px down an 852px
  // screen, so the only control that closes it landed ~22px down — inside a 47–59px notch.
  // ⚠️ COMMENTS STRIPPED. The component's own docblock describes the old bug in its own words
  // (`-top-3 -right-3`), and the first version of this block matched that prose and failed on a
  // correct file — the third time this exact trap has fired in this change. Assert on code.
  const lightbox = readFileSync(resolve(root, 'src/components/chat/ImageLightbox.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  it('there is ONE lightbox, and both chats use it', () => {
    for (const f of ['src/components/ide/AIChat.tsx', 'src/components/sda/SDAChat.tsx']) {
      const src = readFileSync(resolve(root, f), 'utf8');
      expect(src, `${f} should render the shared lightbox`).toContain('<ImageLightbox image={lightbox}');
      // and no longer carries its own copy
      expect(src, `${f} still has an inline lightbox`).not.toMatch(/\{lightbox && \(/);
    }
  });

  it('it carries the contract, above the bar, portalled', () => {
    expect(lightbox).toContain('nb-sheet-overlay nb-sheet-over-nav fixed inset-0 z-[200]');
    expect(lightbox).toContain('createPortal(sheet, document.body)');
  });

  it('🔴 the close button sits INSIDE the card, where the reserve can protect it', () => {
    // Anything hanging outside the card's box is outside the overlay's reserve too.
    expect(lightbox).toContain('absolute top-2 right-2');
    expect(lightbox).not.toContain('-top-3');
  });

  it('the card is NOT full-height — tapping beside a small image must still close it', () => {
    // `h-full` was the obvious way to give the image room to shrink, and it would have made the card
    // swallow every tap on the empty space around a small image (it stops propagation).
    const card = /<div className="(nb-sheet [^"]*)"/.exec(lightbox);
    expect(card, 'lightbox card not found').toBeTruthy();
    expect(card![1]).not.toMatch(/\bh-full\b/);
    expect(lightbox).toContain('min-h-0 max-w-full');   // the image shrinks as a flex item instead
  });
});

describe('the dialogs deliberately LEFT alone — measured clean with their real content', () => {
  // SLICE 3 ADDITION: the twelve short confirm dialogs (AppModals ×6, ExitConfirmDialog,
  // AdminDashboard's confirm, FilesPanel's conflict prompt, ZipSizeModal, GitPanel, VirtualKeyboard)
  // were rendered with a realistic body — a heading, a two-line message and two buttons (five rows
  // of keys for the keyboard) — at portrait 320×568 with a 59px notch and at landscape 667×375 and
  // 844×390. Every one fits all three. They carry no cap because they never need one, and
  // portalling twelve working dialogs to satisfy a census would be all risk and no fix.

  // ⚠️ They stay in the baseline, and this block exists so nobody reads that as a to-do list.
  // A harness that fills every card with 40 paragraphs calls all of these "cropped"; their real
  // content does not. Migrating one anyway means portalling it, which is a real blast radius on
  // screens that work — ModePickerSheet opens on every chat surface in the app. A fix that trades
  // no problem for a new risk is not a fix (CLAUDE.md, "a fix must never trade one problem for
  // another"). Each reason below was measured or read, not assumed:
  const leftAlone: Array<[string, string]> = [
    ['src/components/chat/ModePickerSheet.tsx', "maxHeight: 'min(72dvh, 40rem)'"],     // own dvh cap + env padding
    ['src/components/agentv3/UserActionTray.tsx', "maxHeight: 'min(72dvh, 40rem)'"],  // same design
    ['src/components/ide/FileExplorer.tsx', 'max-h-32 overflow-y-auto'],              // the path list is capped
    ['src/components/ide/PerformanceAnalyzer.tsx', 'w-full h-56'],                    // fixed-height textarea
  ];
  for (const [file, why] of leftAlone) {
    it(`${file.split('/').pop()} still bounds its own content (${why})`, () => {
      // If this ever stops being true, the dialog is no longer self-bounded and belongs in a slice.
      expect(readFileSync(resolve(root, file), 'utf8')).toContain(why);
    });
  }
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

describe('slice 4 — toasts and floating panels: the same chrome, one element smaller', () => {
  // Every dialog above is a `fixed inset-0` overlay, so the scan could only ever see those. A toast
  // anchored to one edge has the identical problem and was invisible to it: measured before this
  // slice, three "Copied" toasts sat 32px (plain phone) to 66px (notched) BEHIND the tab bar, the
  // admin's save toast sat 35px in the notch, the history-open error banner 10px under the bar, the
  // global toast covered 10px of the bar on a notched phone, and the bot builder's help button and
  // panel (z-200) sat ON the bar, covering its right-hand button on every phone.
  //
  // One rule fixes all of them: `.nb-float-bottom` / `.nb-float-top` ADD the chrome that is really on
  // screen to each element's own gap (`--nb-float-gap`), so a desktop — where every chrome variable
  // is 0 — is pixel-identical to before (measured), and only a phone moves.
  const css = readFileSync(resolve(root, 'src/index.css'), 'utf8');
  const stripComments = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

  /** Every className on a `fixed` element, from every client component (server code has no DOM). */
  const fixedClassLists: { file: string; cls: string }[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'server') walk(p); continue; }
      if (!p.endsWith('.tsx') || p.includes('.test.')) continue;
      const src = stripComments(readFileSync(p, 'utf8'));
      for (const m of src.matchAll(/className=(?:\{`|"|\{"|\{cn\(\s*")([^"`]*)/g)) {
        if (/(^|\s)fixed(\s|$)/.test(m[1])) fixedClassLists.push({ file: relative(root, p), cls: m[1] });
      }
    }
  };
  walk(resolve(root, 'src'));

  /** The side a list anchors to with a non-zero gap. `inset-0` / `bottom-0` / `top-0` are flush chrome
   *  (the tab bar itself, headers, overlays) and belong to the dialog contract, not to this one. */
  const anchors = (cls: string, side: 'top' | 'bottom') =>
    new RegExp(`(^|\\s)(${side}-(?!0(\\s|$))[\\d\\[]|inset-y-)`).test(cls);

  it('the rule exists, and it ADDS the chrome rather than replacing the gap', () => {
    expect(css).toContain('bottom: calc(var(--nb-float-gap, 1.5rem) + max(var(--nb-safe-bottom), var(--nb-bottom-nav)));');
    expect(css).toContain('top: calc(var(--nb-float-gap, 1.5rem) + var(--nb-safe-top));');
  });

  it('the scan sees fixed elements at all (a scan that found none would pass everything)', () => {
    expect(fixedClassLists.length).toBeGreaterThan(40);
    expect(fixedClassLists.filter((f) => f.cls.includes('nb-float-')).length).toBeGreaterThanOrEqual(6);
  });

  it('🔴 no element carries the rule AND a utility that silently cancels it', () => {
    // Tailwind emits utilities after @layer components, so `bottom-6` — or a responsive `lg:bottom-6`
    // — beside `nb-float-bottom` wins and the rule does nothing, with no error anywhere. The same shape
    // as `p-0` cancelling the sheet contract on two sheets in slice 1.
    const cancels = (cls: string, side: 'top' | 'bottom') =>
      new RegExp(`(^|\\s)([a-z0-9-]+:)?(${side}-|inset-y-|inset-(\\d|\\[))`).test(cls);
    const bad = fixedClassLists.filter(
      (f) => (f.cls.includes('nb-float-bottom') && cancels(f.cls, 'bottom')) ||
             (f.cls.includes('nb-float-top') && cancels(f.cls, 'top')),
    );
    expect(bad.map((b) => `${b.file}: ${b.cls.slice(0, 80)}`)).toEqual([]);
  });

  it('every fixed element floated off an edge uses the rule, or is on the measured list', () => {
    // A new toast written as `fixed bottom-6` fails here instead of reaching a phone behind the bar.
    const MEASURED_CLEAN: Record<string, string> = {
      // Ctrl+K, z-1001 over everything; its list is capped at 40dvh, so at 390px tall it ends ~110px
      // above the bar. Measured, not assumed — and a keyboard shortcut is not a phone surface anyway.
      'src/components/ide/CommandPalette.tsx': 'top-20',
    };
    const bare = fixedClassLists.filter(
      (f) => (anchors(f.cls, 'bottom') && !f.cls.includes('nb-float-bottom')) ||
             (anchors(f.cls, 'top') && !f.cls.includes('nb-float-top')),
    ).filter((f) => !(MEASURED_CLEAN[f.file] && f.cls.includes(MEASURED_CLEAN[f.file])));
    expect(bare.map((b) => `${b.file}: ${b.cls.slice(0, 90)}`)).toEqual([]);
  });

  const sites = [
    ['src/components/AdminDashboard.tsx', 'nb-float-top fixed right-6 z-[110]'],
    ['src/components/admin/AdminCopyButton.tsx', 'nb-float-bottom fixed left-1/2'],
    ['src/components/ide/ComponentLibrary.tsx', 'nb-float-bottom fixed left-1/2'],
    ['src/components/ide/TeamCollaboration.tsx', 'nb-float-bottom fixed right-6'],
    ['src/components/agentv3/AgentV3Panel.tsx', 'nb-float-bottom fixed inset-x-3 z-[70]'],
    ['src/components/Toast.tsx', 'nb-float-bottom fixed right-4 z-[500]'],
  ] as const;
  for (const [file, needs] of sites) {
    it(`${file.split('/').pop()} floats clear of the chrome`, () => {
      expect(readFileSync(resolve(root, file), 'utf8')).toContain(needs);
    });
  }

  it('the admin save toast paints OVER the header, not under it', () => {
    // It is a toast at the top edge; the header (z-100) covered it at z-50 even on a phone with no
    // notch. Above the header, below the tab bar (150) and every dialog.
    const src = readFileSync(resolve(root, 'src/components/AdminDashboard.tsx'), 'utf8');
    expect(src).not.toContain('fixed top-6 right-6 z-50');
  });

  it('the bot builder help keeps its 1rem gap and is lifted off the tab bar, button AND panel', () => {
    const src = readFileSync(resolve(root, 'src/components/ide/BotBuildHelp.tsx'), 'utf8');
    expect(src.match(/nb-float-bottom fixed right-4 z-\[200\]/g)?.length).toBe(2);
    expect(src.match(/\['--nb-float-gap' as string\]: '1rem'/g)?.length).toBe(2);
  });

  it('the history error banner keeps its 5rem gap, so a desktop sees it exactly where it was', () => {
    const src = readFileSync(resolve(root, 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    expect(src).toContain("style={{ ['--nb-float-gap' as string]: '5rem' }}");
  });
});
