import { describe, it, expect } from 'vitest';
import { paneSplitVars, MIN_PANE_PX, SPLIT_DEFAULT } from './splitPane';

/**
 * REGRESSION (admin 2026-08-20: "preview desktop me theek chal raha, mobile phone me gadbad hai").
 *
 * Both panes shipped the split as `style={{ flex: '0 1 <pct>%', minWidth: MIN_PANE_PX }}`. The split
 * is a WIDTH concept — it exists for the desktop `sm:flex-row` layout — but the same container is
 * `flex-col` on a phone, where the main axis is VERTICAL. So flex-basis silently became a HEIGHT CAP
 * and flex-grow:0 forbade filling: the preview got a strip at the top with dead space beneath, and
 * the `flex-1` class that should have made it fill lost, because an inline style beats a class.
 *
 * The fix ships the split as inert CSS VARIABLES that only a `sm:`-prefixed utility consumes. These
 * tests pin the contract; the emitted CSS was separately verified to place both utilities inside
 * `@media (min-width: 40rem)`, which is what keeps the phone on plain `flex-1`.
 */
describe('paneSplitVars — the split cannot leak onto the phone layout', () => {
  it('emits ONLY custom properties — never `flex` or `minWidth`, which apply on BOTH axes', () => {
    const style = paneSplitVars(70) as Record<string, unknown>;
    expect(Object.keys(style).every((k) => k.startsWith('--'))).toBe(true);
    // The exact shape of the old bug: a flex/minWidth here would cap the height in a column layout.
    expect(style.flex).toBeUndefined();
    expect(style.minWidth).toBeUndefined();
    expect(style.flexBasis).toBeUndefined();
  });

  it('carries the percentage and the minimum the desktop utilities consume', () => {
    const style = paneSplitVars(70) as Record<string, string>;
    expect(style['--nbai-pane']).toBe('70%');
    expect(style['--nbai-pane-min']).toBe(`${MIN_PANE_PX}px`);
  });

  it('the two panes are complements, so together they still fill the row', () => {
    const left = paneSplitVars(SPLIT_DEFAULT) as Record<string, string>;
    const right = paneSplitVars(100 - SPLIT_DEFAULT) as Record<string, string>;
    const pct = (v: string) => Number(v.replace('%', ''));
    expect(pct(left['--nbai-pane']) + pct(right['--nbai-pane'])).toBe(100);
  });

  it('handles the edge percentages a drag can reach without producing junk', () => {
    for (const pct of [1, 50, 99, 0, 100]) {
      expect((paneSplitVars(pct) as Record<string, string>)['--nbai-pane']).toBe(`${pct}%`);
    }
  });
});
