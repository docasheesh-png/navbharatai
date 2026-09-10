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
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', 'src/components/ide/AIChat.tsx'), 'utf8');

/** The composer's textarea class string. */
const TEXTAREA = (() => {
  const at = SRC.indexOf('placeholder="Ask NavBharatAI..."');
  return SRC.slice(at, SRC.indexOf('/>', at));
})();

/** The absolutely-positioned control row, from its opening div to the end of the send button. */
const ROW = (() => {
  const at = SRC.indexOf('<div className="absolute right-2 bottom-1.5 flex gap-1 items-center">');
  return at === -1 ? '' : SRC.slice(at, SRC.indexOf('end inner flex row', at));
})();

const px = (cls: string, m: RegExpMatchArray | null) => (m ? Number(m[1]) : NaN);

describe('the control row fits inside the composer', () => {
  it('the row exists and is bottom-anchored (buttons stay put as the textarea grows)', () => {
    expect(ROW).not.toBe('');
    expect(ROW).toContain('items-center');
  });

  it('the reserved height genuinely covers the row plus a symmetric gap', () => {
    // min-h must be >= button height + bottom inset + an equal top gap, or the row touches the border.
    const minH = px('min-h', TEXTAREA.match(/min-h-\[(\d+)px\]/));
    expect(Number.isFinite(minH)).toBe(true);

    const BUTTON = 36;   // p-2.5 (10px each side) + a w-4 h-4 (16px) icon
    const BOTTOM = 6;    // bottom-1.5
    expect(minH).toBeGreaterThanOrEqual(BUTTON + BOTTOM * 2);
    // The old value made this fail: 40 (and the real 46) are both under 48.
    expect(minH).toBe(48);
  });

  it('EVERY control in the row is the same 36px box — this is the "unaligned" complaint', () => {
    // A control with different padding makes the row taller than the space reserved for it and brings
    // the overflow straight back, so the uniformity is load-bearing, not cosmetic.
    const paddings = ROW.match(/className="[^"]*\bp-(\d(?:\.\d)?)\b[^"]*"/g) ?? [];
    expect(paddings.length).toBeGreaterThanOrEqual(3); // expand + attach + mic + send at minimum
    for (const cls of paddings) {
      expect(cls, `every control must be p-2.5: ${cls}`).toMatch(/\bp-2\.5\b/);
    }
    // The send and stop buttons were the odd ones out at p-3 with a 3.5 icon.
    expect(ROW).not.toMatch(/\bp-3\b/);
    expect(ROW).not.toMatch(/w-3\.5 h-3\.5/);
  });

  it('the icons are all w-4 h-4, so the boxes really are equal', () => {
    const icons = ROW.match(/w-4 h-4/g) ?? [];
    expect(icons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('nothing in the corner is placed by a hand-tuned offset any more', () => {
  it('the expand button lives in the row, not at its own right-N', () => {
    // `right-20` (80px) landed inside a row spanning 8px..126px, so it sat on top of the mic.
    expect(SRC).not.toMatch(/absolute right-20/);
    expect(ROW).toMatch(/Maximize2/);
    expect(ROW).toMatch(/setIsExpanded\(true\)/);
  });

  it('the expand button is still conditional on a long message', () => {
    // Moving it must not make it always-on — it is a long-text affordance.
    expect(ROW).toMatch(/length > 300/);
  });
});

describe('typed text does not run underneath the controls', () => {
  it('the right padding covers the common four-button row', () => {
    const pr = px('pr', TEXTAREA.match(/\bpr-(\d+)\b/));
    expect(Number.isFinite(pr)).toBe(true);
    // Tailwind spacing: pr-N = N * 4px. Four buttons = 4*36 + 3*4 gaps + 8px inset = 164px.
    expect(pr * 4).toBeGreaterThanOrEqual(164);
    // pr-24 (96px) did not even cover three buttons (124px) — text slid under the paperclip.
    expect(pr).toBeGreaterThan(24);
  });
});

describe('the tap targets did not shrink', () => {
  it('the send button is still at least 36px, not trimmed to fit', () => {
    // The fix must not have been "make the buttons smaller until they fit" — that trades one real
    // problem for a worse one on a touch screen.
    expect(ROW).toMatch(/p-2\.5 bg-indigo-600/);
    expect(ROW).toMatch(/p-2\.5 bg-red-600/);
  });
});
