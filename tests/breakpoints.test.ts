import { describe, it, expect } from 'vitest';
import {
  toggleBreakpoint,
  clearFileBreakpoints,
  breakpointList,
  breakpointCount,
  loadBreakpoints,
  serializeBreakpoints,
} from '../src/lib/breakpoints';

/** P-DEV.3 — breakpoint state (pure). */

describe('toggleBreakpoint', () => {
  it('adds, keeps lines sorted, and removes on second toggle', () => {
    let m = toggleBreakpoint({}, 'a.ts', 5);
    expect(m).toEqual({ 'a.ts': [5] });
    m = toggleBreakpoint(m, 'a.ts', 2);
    expect(m).toEqual({ 'a.ts': [2, 5] });
    m = toggleBreakpoint(m, 'a.ts', 5); // toggle off
    expect(m).toEqual({ 'a.ts': [2] });
    m = toggleBreakpoint(m, 'a.ts', 2); // last one off → file pruned
    expect(m).toEqual({});
  });
  it('ignores invalid input', () => {
    expect(toggleBreakpoint({}, '', 3)).toEqual({});
    expect(toggleBreakpoint({}, 'a.ts', 0)).toEqual({});
    expect(toggleBreakpoint({}, 'a.ts', 1.5)).toEqual({});
  });
  it('does not mutate the input map', () => {
    const orig = { 'a.ts': [1] };
    toggleBreakpoint(orig, 'a.ts', 2);
    expect(orig).toEqual({ 'a.ts': [1] });
  });
});

describe('clearFileBreakpoints / list / count', () => {
  it('clears a whole file', () => {
    expect(clearFileBreakpoints({ 'a.ts': [1, 2], 'b.ts': [3] }, 'a.ts')).toEqual({ 'b.ts': [3] });
  });
  it('lists in stable sorted order and counts', () => {
    const m = { 'b.ts': [3], 'a.ts': [2, 1] };
    expect(breakpointList(m)).toEqual([
      { file: 'a.ts', line: 1 },
      { file: 'a.ts', line: 2 },
      { file: 'b.ts', line: 3 },
    ]);
    expect(breakpointCount(m)).toBe(3);
  });
});

describe('load / serialize round-trip + validation', () => {
  it('round-trips', () => {
    const m = { 'a.ts': [1, 4], 'b.ts': [9] };
    expect(loadBreakpoints(serializeBreakpoints(m))).toEqual(m);
  });
  it('tolerates junk and sanitises', () => {
    expect(loadBreakpoints(null)).toEqual({});
    expect(loadBreakpoints('not json')).toEqual({});
    expect(loadBreakpoints('[1,2,3]')).toEqual({}); // array, not a map
    expect(loadBreakpoints(JSON.stringify({ 'a.ts': [3, 3, 0, -1, 'x', 1] }))).toEqual({ 'a.ts': [1, 3] });
  });
});
