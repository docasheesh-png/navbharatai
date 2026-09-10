import { describe, it, expect } from 'vitest';
import { parseReported, decideReportOnce, MAX_REMEMBERED } from './conversionOnce';

describe('parseReported — tolerates anything already in storage', () => {
  it('reads a valid list', () => {
    expect(parseReported('["a","b"]')).toEqual(['a', 'b']);
  });

  it('returns empty for absent, corrupt or wrongly-shaped values', () => {
    expect(parseReported(null)).toEqual([]);
    expect(parseReported(undefined)).toEqual([]);
    expect(parseReported('')).toEqual([]);
    expect(parseReported('{oops')).toEqual([]);
    expect(parseReported('"a string"')).toEqual([]);
    expect(parseReported('[1,2,null]')).toEqual([]);
    expect(parseReported('{"a":1}')).toEqual([]);
  });
});

describe('decideReportOnce — a conversion is counted exactly once', () => {
  it('reports the first time a key is seen', () => {
    const d = decideReportOnce(null, 'order-1', true);
    expect(d.report).toBe(true);
    expect(parseReported(d.nextStored)).toEqual(['order-1']);
  });

  it('REFUSES the same key again — this is what stops one sale being counted twice', () => {
    const first = decideReportOnce(null, 'order-1', true);
    const second = decideReportOnce(first.nextStored, 'order-1', true);
    expect(second.report).toBe(false);
    expect(second.nextStored).toBeNull();
  });

  it('does not report when the caller says the event is not eligible', () => {
    expect(decideReportOnce(null, 'order-1', false).report).toBe(false);
  });

  it('does not report without a key — an unidentifiable event cannot be deduped, so it is not sent', () => {
    expect(decideReportOnce(null, '', true).report).toBe(false);
  });

  it('still reports a DIFFERENT key', () => {
    const first = decideReportOnce(null, 'order-1', true);
    expect(decideReportOnce(first.nextStored, 'order-2', true).report).toBe(true);
  });

  it('caps what it remembers — a dedupe guard, not a history', () => {
    let stored: string | null = null;
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const d = decideReportOnce(stored, key, true);
      if (d.nextStored) stored = d.nextStored;
    }
    expect(parseReported(stored).length).toBe(MAX_REMEMBERED);
    expect(parseReported(stored)[0]).toBe('g'); // most recent kept
  });

  it('a key evicted by the cap can report again — bounded storage is the accepted trade', () => {
    // Documented on purpose: remembering forever would grow without limit, so the guard covers the
    // realistic window (a reload, a second redirect), not an order revisited many purchases later.
    let stored: string | null = decideReportOnce(null, 'old', true).nextStored;
    for (const key of ['a', 'b', 'c', 'd', 'e']) {
      const d = decideReportOnce(stored, key, true);
      if (d.nextStored) stored = d.nextStored;
    }
    expect(parseReported(stored)).not.toContain('old');
    expect(decideReportOnce(stored, 'old', true).report).toBe(true);
  });
});
