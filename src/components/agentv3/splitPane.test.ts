import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SPLIT_DEFAULT, MIN_PANE_PX, SPLIT_STEPS,
  splitBounds, clampSplit, splitFromPointer, nextSplitAction, paneWidthPx, loadSplit, saveSplit,
  DEVICE_WIDTHS, splitForPaneWidth, matchedDevice,
} from './splitPane';

/**
 * The movable chat ⇆ workspace border (admin 2026-08-17).
 *
 * These pin the parts that are tedious to reproduce by hand and easy to get wrong: a window too
 * narrow for both minimums, a split saved on a bigger monitor, and the end of the tap ladder.
 */

describe('splitBounds — what a container can honour', () => {
  it('a wide container allows a generous range', () => {
    const { min, max } = splitBounds(1400);
    expect(min).toBeCloseTo(20, 0);   // 280 of 1400
    expect(max).toBeCloseTo(80, 0);
  });

  it('a container too narrow for two minimums pins to the middle instead of inverting', () => {
    // 400px cannot hold 280 + 280. Returning min > max would make every caller handle a special
    // case; pinning both to 50 keeps clamp/step honest with no branch.
    expect(splitBounds(400)).toEqual({ min: SPLIT_DEFAULT, max: SPLIT_DEFAULT });
  });

  it('the two minimums fit the breakpoint at which the panes stop stacking', () => {
    // The panes go side-by-side at Tailwind's `sm` (640px). If 2 × MIN_PANE_PX exceeded that, the
    // clamp would be fighting the layout it lives in the moment the split appears.
    expect(MIN_PANE_PX * 2).toBeLessThanOrEqual(640);
  });

  it('a zero/unknown width is not a crash', () => {
    expect(splitBounds(0)).toEqual({ min: SPLIT_DEFAULT, max: SPLIT_DEFAULT });
  });
});

describe('clampSplit', () => {
  it('holds a split inside the container bounds', () => {
    expect(clampSplit(95, 1400)).toBeCloseTo(80, 0);
    expect(clampSplit(2, 1400)).toBeCloseTo(20, 0);
    expect(clampSplit(60, 1400)).toBe(60);
  });

  it('rescues a split saved on a WIDER monitor', () => {
    // 25% is fine on 1400 (350px) and impossible on 800 (200px < 280). The stored preference must
    // bend rather than squeeze the composer into unusability.
    expect(clampSplit(25, 1400)).toBe(25);
    expect(clampSplit(25, 800)).toBeCloseTo(35, 0);
  });

  it('a NaN never reaches the layout', () => {
    expect(clampSplit(Number.NaN, 1400)).toBe(SPLIT_DEFAULT);
  });
});

describe('splitFromPointer', () => {
  const rect = { left: 100, width: 1000 };

  it('translates a pointer position into a percentage', () => {
    expect(splitFromPointer(600, rect)).toBe(50);
    expect(splitFromPointer(400, rect)).toBe(30);
  });

  it('dragging past either edge stops at the minimum pane, never past it', () => {
    expect(splitFromPointer(-9999, rect)).toBeCloseTo(28, 0); // 280 of 1000
    expect(splitFromPointer(9999, rect)).toBeCloseTo(72, 0);
  });
});

describe('nextSplitAction — the ◀ ▶ ladder (the tablet path)', () => {
  const WIDE = 1400; // every stop is reachable

  it('▶ walks up the ladder', () => {
    expect(nextSplitAction(25, 'right', WIDE)).toEqual({ kind: 'split', pct: 33 });
    expect(nextSplitAction(33, 'right', WIDE)).toEqual({ kind: 'split', pct: 50 });
    expect(nextSplitAction(50, 'right', WIDE)).toEqual({ kind: 'split', pct: 67 });
  });

  it('◀ walks back down', () => {
    expect(nextSplitAction(75, 'left', WIDE)).toEqual({ kind: 'split', pct: 67 });
    expect(nextSplitAction(50, 'left', WIDE)).toEqual({ kind: 'split', pct: 33 });
  });

  it('▶ past the last stop CLOSES the workspace — "border ko last right"', () => {
    // The admin's actual request. It reuses the existing showWorkspace state rather than encoding
    // "hidden" as a second meaning of the split number.
    expect(nextSplitAction(75, 'right', WIDE)).toEqual({ kind: 'collapse' });
    expect(nextSplitAction(90, 'right', WIDE)).toEqual({ kind: 'collapse' });
  });

  it('◀ at the widest preview stays put — no pretend movement', () => {
    expect(nextSplitAction(25, 'left', WIDE)).toEqual({ kind: 'split', pct: 25 });
  });

  it('a narrow window drops the stops it cannot honour', () => {
    // At 800px, 25% is 200px — under the minimum, so the ladder must not offer it.
    const action = nextSplitAction(50, 'left', 800);
    expect(action.kind).toBe('split');
    if (action.kind === 'split') {
      expect(action.pct).toBeGreaterThanOrEqual(splitBounds(800).min - 0.5);
      expect(action.pct).not.toBe(25);
    }
  });

  it('every ladder stop is a real percentage in ascending order', () => {
    expect([...SPLIT_STEPS]).toEqual([...SPLIT_STEPS].sort((a, b) => a - b));
    for (const s of SPLIT_STEPS) expect(s).toBeGreaterThan(0), expect(s).toBeLessThan(100);
  });
});

describe('paneWidthPx — the live readout while dragging', () => {
  it('reports the WORKSPACE pane width, which is what the user is judging', () => {
    expect(paneWidthPx(50, 1200)).toBe(600);
    expect(paneWidthPx(70, 1200)).toBe(360);
  });
  it('is safe with no measured container', () => {
    expect(paneWidthPx(50, 0)).toBe(0);
  });
});

describe('persistence — a preference that resets is not a preference', () => {
  const fake = (value: string | null) => {
    const store: Record<string, string> = value === null ? {} : { nbai_v3_split_pct: value };
    return {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v; },
      read: () => store.nbai_v3_split_pct,
    };
  };

  it('round-trips a split', () => {
    const s = fake(null);
    saveSplit(67.4, s);
    expect(s.read()).toBe('67');
    expect(loadSplit(s)).toBe(67);
  });

  it('a corrupt or out-of-range value falls back to the default rather than breaking the layout', () => {
    expect(loadSplit(fake('not-a-number'))).toBe(SPLIT_DEFAULT);
    expect(loadSplit(fake('0'))).toBe(SPLIT_DEFAULT);
    expect(loadSplit(fake('100'))).toBe(SPLIT_DEFAULT);
    expect(loadSplit(fake(null))).toBe(SPLIT_DEFAULT);
  });

  it('blocked storage (private mode) is not a crash', () => {
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(loadSplit(throwing)).toBe(SPLIT_DEFAULT);
    expect(() => saveSplit(60, throwing)).not.toThrow();
  });
});

describe('the wiring the layout depends on', () => {
  const panel = readFileSync(join(__dirname, 'AgentV3Panel.tsx'), 'utf8');
  const divider = readFileSync(join(__dirname, 'SplitDivider.tsx'), 'utf8');

  it('the hard-coded 50/50 is gone from both panes', () => {
    // `w-1/2` on either pane would silently win over the inline flex-basis for that pane and the
    // divider would appear to do nothing on one side — a confusing half-broken state.
    expect(panel).not.toContain('sm:w-1/2');
  });

  it('both panes carry the minimum width, so a shrinking WINDOW cannot squeeze one flat', () => {
    const uses = panel.match(/minWidth: MIN_PANE_PX/g) ?? [];
    expect(uses.length).toBe(2);
  });

  it('the divider is hidden on mobile, where the panes stack instead of sharing', () => {
    expect(divider).toContain('hidden sm:flex');
  });

  it('the tap buttons do not start a drag', () => {
    // Without stopPropagation a tap on ◀/▶ also begins a pointer drag on the divider underneath,
    // so a tablet tap would both step AND jump the border to the finger.
    const stops = divider.match(/onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/g) ?? [];
    expect(stops.length).toBe(2);
  });

  it('the drag captures the pointer, or the iframe swallows it', () => {
    expect(divider).toContain('setPointerCapture');
  });

  it('the drag commits ONE layout change, on release', () => {
    // Committing per pointermove reflows the preview iframe dozens of times a second.
    const move = divider.slice(divider.indexOf('const onPointerMove'), divider.indexOf('const endDrag'));
    expect(move).toContain('setGhost');
    expect(move).not.toContain('onSplit');
  });

  it('the divider is a real separator a keyboard can reach', () => {
    expect(divider).toContain('role="separator"');
    expect(divider).toContain('aria-valuenow');
    expect(divider).toContain('tabIndex={0}');
  });
});

describe('one-tap device widths — the divider becomes a real responsive check', () => {
  // Admin 2026-08-17 ("yeh bhi adjust kar ke banao"): a px number visible only WHILE dragging is not
  // a testing tool. Tapping "Phone" must genuinely lay the app out at 390px — and, where the window
  // cannot honour a width, must say so instead of quietly showing something narrower.

  it('the widths are real devices, not round guesses', () => {
    expect(DEVICE_WIDTHS.map((d) => d.px)).toEqual([390, 768]);
  });

  it('a wide window gives the EXACT device width', () => {
    const { pct, exact } = splitForPaneWidth(390, 1400);
    expect(exact).toBe(true);
    expect(paneWidthPx(pct, 1400)).toBe(390);
  });

  it('tablet on a wide window is exact too', () => {
    const { pct, exact } = splitForPaneWidth(768, 1600);
    expect(exact).toBe(true);
    expect(paneWidthPx(pct, 1600)).toBe(768);
  });

  it('a window too narrow reports exact:false rather than pretending', () => {
    // 1000px cannot show a 768px tablet AND keep the chat above its 280px minimum.
    const { pct, exact } = splitForPaneWidth(768, 1000);
    expect(exact).toBe(false);
    expect(paneWidthPx(pct, 1000)).toBe(720);        // the widest honestly available…
    expect(paneWidthPx(pct, 1000)).toBeLessThan(768); // …and visibly NOT the tablet width claimed
  });

  it('an unknown container never claims exactness', () => {
    expect(splitForPaneWidth(390, 0)).toEqual({ pct: SPLIT_DEFAULT, exact: false });
  });

  it('matchedDevice lights the chip the user is actually looking at', () => {
    const phone = splitForPaneWidth(390, 1400).pct;
    expect(matchedDevice(paneWidthPx(phone, 1400), 1400)).toBe('phone');
    const tablet = splitForPaneWidth(768, 1400).pct;
    expect(matchedDevice(paneWidthPx(tablet, 1400), 1400)).toBe('tablet');
  });

  it('the widest the window allows counts as Desktop', () => {
    const widest = splitBounds(1400).min;
    expect(matchedDevice(paneWidthPx(widest, 1400), 1400)).toBe('desktop');
  });

  it('a hand-dragged width matches NOTHING — no chip may falsely claim it', () => {
    // The user dragged to something of their own; lighting a chip would tell them they are looking
    // at a phone when they are not.
    expect(matchedDevice(paneWidthPx(55, 1400), 1400)).toBeNull();
  });

  it('the chips read the MEASURED pane, never the button that was pressed', () => {
    const chips = readFileSync(join(__dirname, 'PreviewWidthChips.tsx'), 'utf8');
    expect(chips).toContain('const paneWidth = paneWidthPx(split, containerPx)');
    // The label must come from that measurement, so an unsatisfiable request self-corrects on screen.
    expect(chips).toContain('${paneWidth}px');
  });

  it('a device that cannot fit is DISABLED, not silently approximated', () => {
    const chips = readFileSync(join(__dirname, 'PreviewWidthChips.tsx'), 'utf8');
    expect(chips).toContain('!exact');
    expect(chips).toContain('disabled={disabled}');
  });
});
