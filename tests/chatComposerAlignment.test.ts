/**
 * The chat composer's control row must be ALIGNED and must FIT (admin 2026-08-31, from a phone
 * screenshot: "send, mic aur attachment ke buttons unaligned hai").
 *
 * Two real defects sat behind that report, and the arithmetic is what pins them:
 *
 * 1. THE ROW DID NOT FIT ITS BOX. The row is absolutely positioned at the bottom of a container whose
 *    height comes from the textarea. That textarea renders 46px (py-2.5 = 20px, plus one 16px line at
 *    leading-relaxed = 26px) — the old `min-h-[40px]` never bound. With the send button at p-3 + a 3.5
 *    icon (38px), the row's top edge landed at 46 - 8 - 38 = 0: flush against the rounded border, so
 *    the filled button read as breaking out of the box.
 *
 * 2. THE EXPAND BUTTON OVERLAPPED THE MIC. It was placed separately at `right-20` (80px) while the row
 *    spans 8px to ~126px (three buttons) or ~166px (four). The magic number was correct when written
 *    and was silently invalidated by a later button being added beside it — which is why the fix is
 *    that every control now lives in ONE flex row rather than at hand-tuned offsets.
 *
 * These are geometry facts, so they are asserted as geometry rather than by rendering: a jsdom render
 * has no layout engine and would report every one of these boxes as 0x0, i.e. it would pass while the
 * phone stayed broken.

 *
 * 🔁 2026-09-23 — THE GEOMETRY CHANGED, THE RULES DID NOT. The box is now the shared two-row
 * `ComposerShell` (admin sketch): text on top at full width, the controls in their own row under it,
 * Send as tall as the box on the right. The control row is no longer absolutely positioned over the
 * text, so "typed text runs under the buttons" is now impossible by structure rather than by a
 * right-hand padding that had to be re-derived for every new button — and a fixed ~176px of that
 * padding is exactly what squeezed the box to a sliver on a phone. Every rule below is kept and
 * re-asserted against the new shape.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { COMPOSER_SEND_CLASS, COMPOSER_STOP_CLASS, COMPOSER_TEXTAREA_CLASS, SEND_SLOT_CLASS } from '../src/components/chat/ComposerShell';
import { RAIL_BUTTON_CLASS } from '../src/components/chat/ModeButton';

const SRC = readFileSync(join(__dirname, '..', 'src/components/ide/AIChat.tsx'), 'utf8');
const SHELL = readFileSync(join(__dirname, '..', 'src/components/chat/ComposerShell.tsx'), 'utf8');

/** The free chat's bottom-row controls: the `controls` prop it hands the shell. */
const ROW = (() => {
  const at = SRC.indexOf('controls={(');
  return at === -1 ? '' : SRC.slice(at, SRC.indexOf('send={(', at));
})();
/** Its Send / Stop: the `send` prop. */
const SEND = (() => {
  const at = SRC.indexOf('send={(');
  return at === -1 ? '' : SRC.slice(at, SRC.indexOf('<textarea', at));
})();

const px = (m: RegExpMatchArray | null) => (m ? Number(m[1]) : NaN);

describe('the control row has its own line, under the text', () => {
  it('the free chat hands its controls and Send to the shared shell', () => {
    expect(SRC).toContain('<ComposerShell');
    expect(ROW).not.toBe('');
    expect(SEND).not.toBe('');
  });

  it('the row is a normal flex row in the shell, never laid over the text', () => {
    expect(SHELL).toContain('<div className="flex items-center justify-end gap-1 px-1.5 pb-1">{controls}</div>');
    expect(SHELL).not.toMatch(/absolute right-\d/);
  });

  it('so the text needs no right-hand reserve, however many controls there are', () => {
    expect(COMPOSER_TEXTAREA_CLASS).not.toMatch(/\bpr-(?:[3-9]\d|\d{3})\b/);
    expect(SRC).not.toContain('pr-44');
  });
});

describe('every control in the row is the same 36px box — the "unaligned" complaint', () => {
  it('p-2.5 everywhere, never p-3', () => {
    const paddings = ROW.match(/className="[^"]*\bp-(\d(?:\.\d)?)\b[^"]*"/g) ?? [];
    expect(paddings.length).toBeGreaterThanOrEqual(2); // expand + mic at minimum (attach passes its own)
    for (const cls of paddings) expect(cls, `every control must be p-2.5: ${cls}`).toMatch(/\bp-2\.5\b/);
    expect(ROW).not.toMatch(/\bp-3\b/);
    expect(ROW).not.toMatch(/w-3\.5 h-3\.5/);
  });

  it('the icons are all w-4 h-4, so the boxes really are equal', () => {
    expect((ROW.match(/w-4 h-4/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('nothing is placed by a hand-tuned offset', () => {
  it('the expand button lives in the row, not at its own right-N', () => {
    expect(SRC).not.toMatch(/absolute right-20/);
    expect(ROW).toMatch(/Maximize2/);
    expect(ROW).toMatch(/setIsExpanded\(true\)/);
  });

  it('the expand button is still conditional on a long message', () => {
    expect(ROW).toMatch(/length > 300/);
  });
});

describe('the tap targets did not shrink', () => {
  it('Send and Stop fill their slot and are wider than a 36px control', () => {
    expect(SEND).toContain('className={COMPOSER_SEND_CLASS}');
    expect(SEND).toContain('className={COMPOSER_STOP_CLASS}');
    for (const cls of [COMPOSER_SEND_CLASS, COMPOSER_STOP_CLASS]) {
      expect(cls).toContain('h-full');
      expect(cls).toContain('min-h-10'); // never below a 40px target, in either layout
      expect(cls).toContain('w-11'); // 44px
    }
  });

  it('beside the History / Mode column, Send is still at least 72px tall (the two-row box)', () => {
    // The slot owns the height now (2026-09-24), so the one-line box can exist at all: 84px slot minus
    // its 6px padding top and bottom leaves 72px for the button, exactly as before.
    expect(px(SEND_SLOT_CLASS.twoRows.match(/min-h-\[(\d+)px\]/)) - 12).toBeGreaterThanOrEqual(72);
    expect(SEND_SLOT_CLASS.twoRows).toContain('p-1.5');
    expect(SEND_SLOT_CLASS.oneLine).not.toMatch(/min-h-\[/);
  });

  it('the box at rest is tall enough for the two rail buttons beside it', () => {
    // text row (min 40) + control row (36 + pb-1) ≥ two rail buttons (min 36 each) + the 6px gap.
    const text = px(COMPOSER_TEXTAREA_CLASS.match(/min-h-\[(\d+)px\]/));
    const rail = px(RAIL_BUTTON_CLASS.match(/min-h-\[(\d+)px\]/));
    expect(text + 36 + 4).toBeGreaterThanOrEqual(rail * 2 + 6);
  });
});
