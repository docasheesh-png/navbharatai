import { describe, it, expect } from 'vitest';
import { isFlex, isLayoutMode, LAYOUT_MODES } from './visualLayout';

/** Record what a mode writes, so the declarations are asserted rather than assumed. */
const applied = (id: string): Record<string, string> => {
  const out: Record<string, string> = {};
  LAYOUT_MODES.find((m) => m.id === id)!.apply((prop, val) => { out[prop] = val; });
  return out;
};

describe('isFlex', () => {
  it('recognises both flex displays', () => {
    expect(isFlex({ display: 'flex' })).toBe(true);
    expect(isFlex({ display: 'inline-flex' })).toBe(true);
  });

  it('is false for everything else, including grid', () => {
    expect(isFlex({ display: 'block' })).toBe(false);
    expect(isFlex({ display: 'grid' })).toBe(false);
    expect(isFlex({})).toBe(false);
    expect(isFlex(undefined)).toBe(false);
    expect(isFlex(null)).toBe(false);
  });
});

describe('isLayoutMode — a toggle that lights up the wrong button teaches the user the panel lies', () => {
  it('shows Row for a flex row and Column for a flex column', () => {
    expect(isLayoutMode({ display: 'flex', flexDirection: 'row' }, 'row')).toBe(true);
    expect(isLayoutMode({ display: 'flex', flexDirection: 'row' }, 'column')).toBe(false);
    expect(isLayoutMode({ display: 'flex', flexDirection: 'column' }, 'column')).toBe(true);
  });

  it('treats a reversed direction as its axis, because that is what the user sees', () => {
    expect(isLayoutMode({ display: 'flex', flexDirection: 'row-reverse' }, 'row')).toBe(true);
    expect(isLayoutMode({ display: 'flex', flexDirection: 'column-reverse' }, 'column')).toBe(true);
  });

  it('defaults to Row when a flex container has no direction set', () => {
    // `row` is the CSS initial value, so a flex element with nothing declared genuinely IS a row.
    expect(isLayoutMode({ display: 'flex' }, 'row')).toBe(true);
  });

  it('does NOT claim Row for a grid — "block" means "not flex", not literally display:block', () => {
    // An element can be grid, inline-block or a table cell; none of those is the row or column the
    // other two buttons produce, so lighting one up would be a claim the panel cannot back up.
    expect(isLayoutMode({ display: 'grid' }, 'block')).toBe(true);
    expect(isLayoutMode({ display: 'grid' }, 'row')).toBe(false);
    expect(isLayoutMode({ display: 'inline-block' }, 'block')).toBe(true);
    expect(isLayoutMode({}, 'block')).toBe(true);
  });

  it('exactly one mode is ever active', () => {
    for (const styles of [{}, { display: 'flex' }, { display: 'flex', flexDirection: 'column' }, { display: 'grid' }]) {
      const active = LAYOUT_MODES.filter((m) => isLayoutMode(styles, m.id));
      expect(active, `for ${JSON.stringify(styles)}`).toHaveLength(1);
    }
  });
});

describe('what each button actually writes', () => {
  it('Stack CLEARS the flex declarations instead of leaving them behind', () => {
    // A leftover gap or justify-content does nothing visible as a block, then reappears the moment
    // the user picks Row again — which looks like the editor remembering a setting they never made.
    const out = applied('block');
    expect(out.display).toBe('block');
    for (const prop of ['gap', 'justifyContent', 'alignItems', 'flexWrap']) {
      expect(out[prop]).toBe('');
    }
  });

  it('Row wraps by default, because a nowrap row overflows a phone', () => {
    // The classic desktop-built row that breaks on a 390px screen — and the user changing this
    // control is rarely thinking about mobile at that moment.
    expect(applied('row')).toMatchObject({ display: 'flex', flexDirection: 'row', flexWrap: 'wrap' });
  });

  it('Column sets the axis and nothing it does not need to', () => {
    const out = applied('column');
    expect(out).toMatchObject({ display: 'flex', flexDirection: 'column' });
    expect(out.flexWrap).toBeUndefined();
  });

  it('every mode has a label and a tooltip a non-technical user can read', () => {
    for (const m of LAYOUT_MODES) {
      expect(m.label).toBeTruthy();
      expect(m.title.length).toBeGreaterThan(8);
      // The point of the panel is to avoid CSS jargon in front of the user.
      expect(m.label.toLowerCase()).not.toContain('flex');
    }
  });
});
