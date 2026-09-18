import { describe, it, expect } from 'vitest';
import {
  placeReportInfoPanel,
  PANEL_MAX_WIDTH,
  VIEWPORT_GUTTER,
} from './reportInfoPlacement';

/**
 * "dono build report ke andar jo i button hai … popup crop ho raha hai" (admin 2026-09-18).
 *
 * The crop had TWO independent causes and this file encodes both, because fixing either alone
 * leaves the admin looking at a cut-off panel:
 *   1. the panel was laid out inside a `rounded-xl overflow-hidden` row card — fixed by portalling
 *      it to <body>, which is a structural change these arithmetic tests cannot see; and
 *   2. it was right-aligned to a button that a phone-width row pushes past the viewport edge —
 *      which is what every case below pins.
 *
 * The admin's own phone is 393 px wide; the screenshot that prompted this was taken on it.
 */
const PHONE_W = 393;
const PHONE_H = 852;

/** A panel is only correct if the WHOLE of it is on screen, with its gutter intact. */
function assertFullyOnScreen(p: { left: number; width: number }, viewportWidth: number) {
  expect(p.left).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
  expect(p.left + p.width).toBeLessThanOrEqual(viewportWidth - VIEWPORT_GUTTER);
}

describe('placeReportInfoPanel', () => {
  it('right-aligns to the button when there is room to its left', () => {
    // A comfortable desktop row: the button's right edge at 900 px of a 1440 px page.
    const p = placeReportInfoPanel({ top: 300, bottom: 324, right: 900 }, 1440, 900);
    expect(p.width).toBe(PANEL_MAX_WIDTH);
    expect(p.left).toBe(900 - PANEL_MAX_WIDTH);
    assertFullyOnScreen(p, 1440);
  });

  it('🔴 THE REPORTED BUG: a button pushed PAST the right edge still yields a fully visible panel', () => {
    // The all-builds row is a flex line of shrink-0 controls. On a 393 px phone it overflows its
    // card, so the ⓘ button's own rect sits beyond the viewport — here 60 px past it. Plain
    // right-alignment would put the panel's right edge at 453 and crop 68 px of it away, which is
    // exactly the screenshot the admin sent.
    const p = placeReportInfoPanel({ top: 300, bottom: 324, right: PHONE_W + 60 }, PHONE_W, PHONE_H);
    assertFullyOnScreen(p, PHONE_W);
    // And it is pulled as far right as the gutter allows, so it stays visually tied to its button.
    expect(p.left).toBe(PHONE_W - p.width - VIEWPORT_GUTTER);
  });

  it('never runs off the LEFT edge when the button sits near the start of the row', () => {
    const p = placeReportInfoPanel({ top: 300, bottom: 324, right: 40 }, PHONE_W, PHONE_H);
    assertFullyOnScreen(p, PHONE_W);
    expect(p.left).toBe(VIEWPORT_GUTTER);
  });

  it('narrows to fit a viewport smaller than the panel, keeping both gutters', () => {
    const narrow = 240;
    const p = placeReportInfoPanel({ top: 100, bottom: 124, right: 230 }, narrow, PHONE_H);
    expect(p.width).toBe(narrow - VIEWPORT_GUTTER * 2);
    assertFullyOnScreen(p, narrow);
  });

  it('opens downward with a height bounded by the room actually below it', () => {
    const p = placeReportInfoPanel({ top: 300, bottom: 324, right: 380 }, PHONE_W, PHONE_H);
    expect(p.top).toBe(324 + 6);
    expect(p.bottom).toBeUndefined();
    expect(p.top! + p.maxHeight).toBeLessThanOrEqual(PHONE_H);
  });

  it('flips above when the row is near the bottom of the screen', () => {
    // A row 40 px off the bottom: opening downward would leave the panel a sliver.
    const p = placeReportInfoPanel({ top: 788, bottom: 812, right: 380 }, PHONE_W, PHONE_H);
    expect(p.top).toBeUndefined();
    expect(p.bottom).toBe(PHONE_H - 788 + 6);
    // The flipped panel still fits in the space above the button.
    expect(p.maxHeight).toBeLessThanOrEqual(788);
  });

  it('does NOT flip into a space smaller than the one below', () => {
    // Cramped both ways, but below is the roomier of the two — flipping would make it worse.
    const p = placeReportInfoPanel({ top: 30, bottom: 54, right: 380 }, PHONE_W, 200);
    expect(p.top).toBe(54 + 6);
  });

  it('gives a usable height even when no direction has room', () => {
    const p = placeReportInfoPanel({ top: 40, bottom: 64, right: 380 }, PHONE_W, 80);
    expect(p.maxHeight).toBeGreaterThan(0);
  });
});

/**
 * REVERSION GUARD. The structural half of the fix — the portal — is invisible to arithmetic, so it
 * is pinned by reading the source: a panel that goes back to being an `absolute` child of the row is
 * clipped by the card's `overflow-hidden` again and NO placement test would notice.
 */
describe('the panel escapes the row card', () => {
  it('is rendered through a portal into document.body, not positioned inside the row', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const raw = fs.readFileSync(path.join(__dirname, 'ReportInfoButton.tsx'), 'utf8');
    // Comments are stripped first: the header comment DESCRIBES the old `absolute top-full`
    // positioning as the bug being fixed, and a guard that cannot tell code from prose would fail
    // on the very explanation of why it exists.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    expect(src).toMatch(/createPortal\(/);
    expect(src).toMatch(/document\.body/);
    // The old, clipped positioning must not come back.
    expect(src).not.toMatch(/absolute top-full/);
  });
});
