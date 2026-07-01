import { describe, it, expect } from 'vitest';
import {
  lineOfOffset,
  lineCount,
  offsetRangeOfLine,
  buildAnnotation,
  sortAnnotations,
  type CommentAnnotation,
} from './collabAnnotations';

/** P-DESIGN.7 — pure collaboration-annotation logic (caret→line, ranges, comment records). */

const SAMPLE = 'line one\nline two\nline three'; // offsets: 0..8='line one', 9=start of two, 18=start of three

describe('lineOfOffset', () => {
  it('maps caret offsets to 1-based line numbers', () => {
    expect(lineOfOffset(SAMPLE, 0)).toBe(1);
    expect(lineOfOffset(SAMPLE, 5)).toBe(1);
    expect(lineOfOffset(SAMPLE, 9)).toBe(2); // just after the first \n
    expect(lineOfOffset(SAMPLE, 18)).toBe(3);
  });
  it('clamps out-of-range and non-finite offsets', () => {
    expect(lineOfOffset(SAMPLE, -5)).toBe(1);
    expect(lineOfOffset(SAMPLE, 9999)).toBe(3);
    expect(lineOfOffset(SAMPLE, NaN)).toBe(1);
  });
  it('empty buffer is line 1', () => {
    expect(lineOfOffset('', 0)).toBe(1);
  });
});

describe('lineCount', () => {
  it('counts lines (>=1)', () => {
    expect(lineCount('')).toBe(1);
    expect(lineCount('a')).toBe(1);
    expect(lineCount(SAMPLE)).toBe(3);
    expect(lineCount('a\nb\n')).toBe(3); // trailing newline opens an empty 3rd line
  });
});

describe('offsetRangeOfLine', () => {
  it('returns [start,end] excluding the trailing newline', () => {
    expect(offsetRangeOfLine(SAMPLE, 1)).toEqual([0, 8]);
    expect(offsetRangeOfLine(SAMPLE, 2)).toEqual([9, 17]);
    expect(offsetRangeOfLine(SAMPLE, 3)).toEqual([18, 28]);
  });
  it('round-trips with lineOfOffset (start of a line maps back to that line)', () => {
    for (let ln = 1; ln <= 3; ln++) {
      const [start] = offsetRangeOfLine(SAMPLE, ln);
      expect(lineOfOffset(SAMPLE, start)).toBe(ln);
    }
  });
  it('a line past the end collapses to the buffer end', () => {
    expect(offsetRangeOfLine(SAMPLE, 99)).toEqual([SAMPLE.length, SAMPLE.length]);
  });
});

describe('buildAnnotation', () => {
  it('normalises a comment record', () => {
    const a = buildAnnotation({ id: 'c1', line: 4, text: '  fix this  ', authorId: 'u1', authorName: 'Priya', color: '#10b981', timestamp: 100 });
    expect(a).toEqual({ id: 'c1', line: 4, text: 'fix this', authorId: 'u1', authorName: 'Priya', color: '#10b981', timestamp: 100, resolved: false });
  });
  it('guards bad line/color/timestamp and clamps very long text', () => {
    const a = buildAnnotation({ id: 'c2', line: 0, text: 'x'.repeat(5000), authorId: 'u', color: 'not-a-color', timestamp: -1 });
    expect(a.line).toBe(1);
    expect(a.color).toBe('#6366f1');
    expect(a.timestamp).toBe(0);
    expect(a.text.length).toBe(2000);
    expect(a.authorName).toBe('User');
  });
});

describe('sortAnnotations', () => {
  it('unresolved first, then by line, then by time', () => {
    const list: CommentAnnotation[] = [
      { id: 'a', line: 5, text: '', authorId: '', authorName: '', color: '#fff', timestamp: 2, resolved: false },
      { id: 'b', line: 1, text: '', authorId: '', authorName: '', color: '#fff', timestamp: 1, resolved: true },
      { id: 'c', line: 5, text: '', authorId: '', authorName: '', color: '#fff', timestamp: 1, resolved: false },
      { id: 'd', line: 2, text: '', authorId: '', authorName: '', color: '#fff', timestamp: 1, resolved: false },
    ];
    expect(sortAnnotations(list).map(a => a.id)).toEqual(['d', 'c', 'a', 'b']);
  });
  it('does not mutate the input', () => {
    const list: CommentAnnotation[] = [
      { id: 'x', line: 2, text: '', authorId: '', authorName: '', color: '#fff', timestamp: 1, resolved: false },
      { id: 'y', line: 1, text: '', authorId: '', authorName: '', color: '#fff', timestamp: 1, resolved: false },
    ];
    sortAnnotations(list);
    expect(list.map(a => a.id)).toEqual(['x', 'y']);
  });
});
