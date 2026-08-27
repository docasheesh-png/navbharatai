import { describe, it, expect } from 'vitest';
import { toggleCompareSelection, compareOrder } from './checkpointCompare';

describe('toggleCompareSelection', () => {
  it('picks up to two; a third replaces the oldest pick', () => {
    let sel: string[] = [];
    sel = toggleCompareSelection(sel, 'a');
    sel = toggleCompareSelection(sel, 'b');
    expect(sel).toEqual(['a', 'b']);
    sel = toggleCompareSelection(sel, 'c');
    expect(sel).toEqual(['b', 'c']);
  });
  it('toggles a selected sha off', () => {
    expect(toggleCompareSelection(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('compareOrder — the inversion this file exists to prevent', () => {
  const list = ['newest', 'middle', 'oldest']; // History renders newest first
  it('the sha further DOWN the list is the base (older), whichever was clicked first', () => {
    expect(compareOrder(list, ['newest', 'oldest'])).toEqual({ from: 'oldest', to: 'newest' });
    expect(compareOrder(list, ['oldest', 'newest'])).toEqual({ from: 'oldest', to: 'newest' });
  });
  it('null for anything but exactly two known shas', () => {
    expect(compareOrder(list, ['newest'])).toBeNull();
    expect(compareOrder(list, ['newest', 'ghost'])).toBeNull();
  });
});
