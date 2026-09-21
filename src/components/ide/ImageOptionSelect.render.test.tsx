import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageOptionSelect, currentOption, type ImageOption } from './ImageOptionSelect';

/**
 * 🔒 FOUR CHIP ROWS BECAME FOUR DROPDOWNS, AND THE SCREEN BECAME A CHAT.
 *
 * Admin, 2026-09-21: *"images type . style .size/formate .colour hint yeh sab ko dropdown selector
 * bana do! jisse ui clear lage. aur pure chat box ka ui bhi sabhi ai ke jaise banao. sabse niche
 * input box. uske upar 4 selector."*
 *
 * WHAT WAS WRONG. The free image generator drew all four option groups in full — eight image types,
 * seven styles, four sizes, six colour dots — above the prompt box, in a two-column desktop layout
 * that stacked on a phone into one long form with the Generate button below about twenty-five
 * controls. The one component that serves BOTH the Mode surface and Other Tools' image generator, so
 * both screens had it.
 *
 * ⚠️ WHY SO MUCH OF THIS IS ASSERTED FROM SOURCE. The requirements here are LAYOUT ones — what sits
 * above what — and `renderToStaticMarkup` produces no layout at all. Worse, `AIImageGenerator.tsx`
 * pulls in Firebase and Capacitor, so it cannot even be imported in a node test. Source order IS
 * visual order in a column flexbox, and that is the thing that must not drift back. The same
 * reasoning `ImageStudioPro.render.test.tsx` already records for the paid studio.
 *
 * ⚠️ AND WHY THE REGEXES CARRY BOUNDARIES. A bare `toContain('<ImageOptionSelect')` still passes when
 * the element is renamed `<ImageOptionSelectOld` — this repo has now paid for that weak-assertion
 * shape five times. Every element check below matches the tag boundary too.
 */

const DIR = __dirname;
const GEN = readFileSync(join(DIR, 'AIImageGenerator.tsx'), 'utf8');
const PRO = readFileSync(join(DIR, 'ImageStudioPro.tsx'), 'utf8');
const SEL = readFileSync(join(DIR, 'ImageOptionSelect.tsx'), 'utf8');
/** Comments are prose. A note that QUOTES an old class name must not make an assertion pass or fail. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const STYLES: ImageOption[] = [
  { id: 'photo', label: 'Realistic', desc: 'Real photo look', emoji: '📷' },
  { id: 'minimal', label: 'Minimal', desc: 'Clean and simple', emoji: '⬜' },
  { id: 'dark', label: 'Dark', desc: 'Dark aesthetic', emoji: '🌑' },
];

describe('the fallback rule lives in one place (pure)', () => {
  it('an id that matches wins', () => {
    expect(currentOption(STYLES, 'dark')?.label).toBe('Dark');
  });

  it('🔴 an id nothing matches falls back to the FIRST option, never to nothing', () => {
    // A history row saved by an older build can carry a style id this build no longer has. The old
    // panel handled that with `SIZES.find(...) || SIZES[0]` written out at each call site; this is
    // that rule, once.
    expect(currentOption(STYLES, 'gradient-x')?.label).toBe('Realistic');
    expect(currentOption(STYLES, '')?.label).toBe('Realistic');
  });

  it('an empty list yields undefined rather than throwing', () => {
    expect(currentOption([], 'anything')).toBeUndefined();
  });
});

describe('the selector shows ONE line, not the whole list', () => {
  const html = renderToStaticMarkup(
    <ImageOptionSelect label="Style" heading="How should it look?" options={STYLES} value="minimal" onChange={() => {}} />,
  );

  it('names the group and the chosen value', () => {
    expect(html).toContain('Style');
    expect(html).toContain('Minimal');
  });

  it('🔴 the options that are NOT chosen are off the screen — this is the whole change', () => {
    // If these ever appear in the closed markup, the dropdown has silently become a chip row again
    // and the twenty-five controls are back above the prompt box.
    expect(html).not.toContain('Realistic');
    expect(html).not.toContain('Dark aesthetic');
    expect(html).not.toContain('How should it look?');
  });

  it('is a real button, announced as something that opens', () => {
    // Never a div with an onClick: Tab skips those, and this is a required control.
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"/);
    expect(html).toContain('aria-expanded="false"');
  });

  it('honours disabled', () => {
    const off = renderToStaticMarkup(
      <ImageOptionSelect label="Style" heading="x" options={STYLES} value="minimal" onChange={() => {}} disabled />,
    );
    expect(off).toContain('disabled=""');
  });

  it('a value nothing matches still renders the first option, not a blank control', () => {
    const odd = renderToStaticMarkup(
      <ImageOptionSelect label="Style" heading="x" options={STYLES} value="nope" onChange={() => {}} />,
    );
    expect(odd).toContain('Realistic');
  });
});

describe('🔒 the sheet uses the SHARED geometry, never a hand-written viewport fraction', () => {
  it('pairs the flush overlay with the sheet card and the partial cap', () => {
    const src = code(SEL);
    expect(src).toContain('nb-sheet-overlay-flush');
    expect(src).toMatch(/nb-sheet nb-sheet-partial/);
  });

  it('🔴 no bare `vh` cap — on a phone that is the LARGE viewport', () => {
    // A `max-h-[80vh]` puts the last rows under the browser toolbar AND under this app's own tab
    // bar, where there is no scroll left to reach them. The same bug already cost this repo the
    // publish sheet and, in this very feature, the text editor's Done button.
    expect(code(SEL)).not.toMatch(/max-h-\[\d+vh\]/);
  });

  it('sits BELOW the tab bar, which is what pairs it with reserving rather than opting out', () => {
    // tests/sheetOverlayGeometry.test.ts enforces the pairing across the app; this pins the side
    // this component chose, so a later z-index bump has to change both together.
    expect(code(SEL)).toMatch(/nb-sheet-overlay-flush[^"]*\bz-50\b/);
    expect(code(SEL)).not.toContain('nb-sheet-over-nav');
  });

  it('exactly one option is in force, and a screen reader is told so', () => {
    expect(code(SEL)).toContain('role="radiogroup"');
    expect(code(SEL)).toMatch(/role="radio"/);
    expect(code(SEL)).toMatch(/aria-checked=\{sel\}/);
    expect(code(SEL)).toContain('aria-modal="true"');
  });

  it('Escape closes it', () => {
    expect(code(SEL)).toMatch(/e\.key === 'Escape'/);
  });
});

describe('🔒 ONE selector, used by both screens — no second copy of the sheet', () => {
  it('neither image screen declares an overlay of its own', () => {
    // Four hand-rolled sheets is four chances for Escape, the scrim, the tick or the tab-bar
    // reservation to be right in three places and wrong in the fourth. This repo has paid for the
    // drifted-copy class four separate times already.
    expect(code(GEN)).not.toContain('nb-sheet-overlay');
    expect(code(PRO)).not.toContain('nb-sheet-overlay');
  });

  it('both screens mount the shared component', () => {
    expect(code(GEN)).toMatch(/<ImageOptionSelect[\s/>]/);
    expect(code(PRO)).toMatch(/<ImageOptionSelect[\s/>]/);
  });
});

describe('🔒 all four groups became dropdowns — none of them is a chip row any more', () => {
  const src = code(GEN);

  it('four selectors are mounted', () => {
    expect(src.match(/<ImageOptionSelect[\s/>]/g)?.length).toBe(4);
  });

  it('each of the four groups is named on one', () => {
    for (const label of ['Image type', 'Style', 'Size / format', 'Colour hint']) {
      expect(src, `no selector labelled ${label}`).toContain(`label="${label}"`);
    }
  });

  it('🔴 the old chip grids are gone — not hidden, gone', () => {
    // These four JSX loops WERE the twenty-five controls. If any comes back, the screen the admin
    // asked to be cleared has been un-cleared.
    //
    // ⚠️ The leading brace is load-bearing, and the first draft of this case did not have it: it
    // asserted on `IMAGE_TYPES.map(` alone and failed on `const IMAGE_TYPE_OPTIONS = IMAGE_TYPES
    // .map(...)`, a data transform feeding the selector. `{X.map(` only ever occurs inside JSX, so
    // it names the chip row and nothing else.
    for (const gone of ['{STYLES.map(', '{SIZES.map(', '{IMAGE_TYPES.map(', '{COLOR_HINTS.map(']) {
      expect(src, `${gone} is back in the panel`).not.toContain(gone);
    }
  });

  it('…and that guard would really catch a chip row coming back', () => {
    // Proving the assertion above is not vacuous: the pattern it forbids is exactly the shape the
    // deleted code had, and it matches when that shape is present.
    const asItWas = '<div className="flex flex-wrap gap-1.5">{IMAGE_TYPES.map(t => (<button key={t} />))}</div>';
    expect(asItWas).toContain('{IMAGE_TYPES.map(');
  });

  it('🔴 the colour hint is a CHOSEN value, not words appended to the user’s prompt', () => {
    // The old dots did `setPrompt(p => p + ' in indigo tones')` on every press, so two presses wrote
    // the phrase twice and changing your mind meant editing your own text. It is folded in at send
    // time now, which is what the other three groups always did.
    expect(src).not.toMatch(/setPrompt\(p\s*=>\s*p\s*\+/);
    expect(src).toMatch(/colorHint === 'none'/);
  });
});

describe('🔒 the chat shape: input at the very bottom, four selectors directly above it', () => {
  const src = code(GEN);
  const free = src.slice(src.indexOf('flex-1 min-h-0 flex flex-col'));

  it('the thread is declared before the dock, and only the thread scrolls', () => {
    const thread = free.indexOf('flex-1 min-h-0 overflow-y-auto');
    const dock = free.indexOf('shrink-0 border-t');
    expect(thread, 'the scrolling thread is missing').toBeGreaterThan(-1);
    expect(dock, 'the pinned dock is missing').toBeGreaterThan(-1);
    // Source order IS visual order in a column flexbox. Swapping these two is exactly how the
    // inversion gets undone.
    expect(thread).toBeLessThan(dock);
  });

  it('🔴 the four selectors come BEFORE the input, inside the dock', () => {
    const dock = free.indexOf('shrink-0 border-t');
    const firstSelector = free.indexOf('<ImageOptionSelect', dock);
    const lastSelector = free.lastIndexOf('<ImageOptionSelect');
    const input = free.indexOf('<textarea', dock);
    expect(firstSelector).toBeGreaterThan(dock);
    expect(input, 'the composer is missing from the dock').toBeGreaterThan(-1);
    expect(lastSelector, 'a selector is rendered below the input').toBeLessThan(input);
  });

  it('the dock cannot be pushed off the bottom by a long thread', () => {
    // `min-h-0` on the thread is what makes it scroll inside itself instead of growing the column.
    expect(free).toMatch(/flex-1 min-h-0/);
    expect(free).toMatch(/shrink-0[^"]*border-t/);
  });

  it('Enter sends and the newest image is scrolled to', () => {
    expect(src).toMatch(/e\.key === 'Enter' && !e\.shiftKey/);
    expect(src).toMatch(/scrollIntoView/);
  });

  it('the press is answered before the image arrives', () => {
    // A blank thread while the engine works reads as a dead button — the blank-screen failure this
    // repo already root-caused once on the chat path.
    expect(src).toMatch(/setPending\(\{/);
  });
});

describe('🔒 each image in the thread carries its OWN actions', () => {
  const src = code(GEN);

  it('copy, save, text and delete all name which image', () => {
    // The old screen showed one image, so `handleCopyImage()` could mean "the image". In a thread
    // that is ambiguous, and an action that silently picks the newest is a wrong answer, not a bug
    // anyone would see.
    //
    // ⚠️ THIS USED TO PIN THE EXACT CALL SHAPE (`handleCopyImage(item.id, item.url)`), and on
    // 2026-09-21 a legitimate change broke it without breaking the property: a free picture may now
    // arrive as a link rather than as bytes, so Copy, Save and Add text first pass through
    // `ensureLocalImage(item.id)` and hand on what it returns. The property is "every action is
    // parameterised by the row it sits on, never by ambient state" — so that is what is asserted,
    // per handler, rather than one spelling of it.
    const handlers = [...src.matchAll(/onClick=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)].map((m) => m[1]);
    const rowHandlers = handlers.filter((h) => /handleCopyImage|handleDownload|setTextOn|handleDeleteOne/.test(h));
    expect(rowHandlers.length, 'the four per-image actions must still be there').toBeGreaterThanOrEqual(4);
    for (const h of rowHandlers) {
      expect(h, `an action that does not name its image: ${h}`).toMatch(/item\./);
    }
    // And each of the four is present by name, wherever it now sits in the chain.
    for (const fn of ['handleCopyImage(', 'handleDownload(', 'setTextOn(', 'handleDeleteOne(']) {
      expect(src, `${fn} disappeared`).toContain(fn);
    }
    // The ambiguous form the original guard existed to forbid stays forbidden.
    expect(src).not.toMatch(/handleCopyImage\(\)/);
    expect(src).not.toMatch(/handleDeleteOne\(\)/);
  });

  it('🔴 "Add text" reads the words that asked for THAT image, not the composer', () => {
    // Until this screen became a thread there was one image and one prompt, so "whatever is in the
    // box" was the same thing. It is not any more: the box is cleared on a successful send, so a
    // user scrolling up to put a phone number on their first image would have got the text of their
    // third request — or, more often, nothing at all.
    expect(src).toMatch(/extractImageText\(target\.prompt\)/);
    expect(src).not.toMatch(/extractImageText\(prompt\)/);
  });

  it('applying text replaces that image in place, and persists it', () => {
    expect(src).toMatch(/imageHistoryStore\.save\(updated\)/);
  });
});

describe('🔒 the promises this screen already made are unchanged', () => {
  it('the free tier still advertises no price', () => {
    const free = code(GEN).split("effectiveTier === 'pro'")[0];
    expect(free).not.toMatch(/₹/);
  });

  it('neither screen names a vendor or a model', () => {
    for (const [name, src] of [['AIImageGenerator', GEN], ['ImageStudioPro', PRO], ['ImageOptionSelect', SEL]] as const) {
      const lower = code(src).toLowerCase();
      for (const bad of ['flux', 'bfl', 'black forest', 'fal.ai', 'replicate', 'pollinations', 'openai', 'dall', 'midjourney', 'stability', 'wavespeed']) {
        expect(lower, `${name} leaked "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('no Devanagari reaches any of the three', () => {
    for (const [name, src] of [['AIImageGenerator', GEN], ['ImageStudioPro', PRO], ['ImageOptionSelect', SEL]] as const) {
      expect(code(src), `${name} contains Devanagari`).not.toMatch(/[ऀ-ॿ]/);
    }
  });

  it('paging survived the rewrite — fifty data URLs never enter the DOM at once', () => {
    expect(code(GEN)).toMatch(/<LoadMore[\s/>]/);
    expect(code(GEN)).toMatch(/pagedHistory\.visible/);
  });

  it('…and the sources this file reads are really there', () => {
    // Without this, a bad path would make every assertion above vacuously pass on an empty string.
    for (const [name, src] of [['AIImageGenerator', GEN], ['ImageStudioPro', PRO], ['ImageOptionSelect', SEL]] as const) {
      expect(src.length, `${name} read empty`).toBeGreaterThan(2000);
    }
  });
});
