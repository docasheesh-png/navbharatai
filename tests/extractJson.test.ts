import { describe, it, expect } from 'vitest';
import { extractFirstJson } from '../src/server/lib/extractJson';

describe('extractFirstJson', () => {
  it('parses a bare JSON array or object', () => {
    expect(extractFirstJson('[{"op":"write","path":"a.ts"}]')).toEqual([{ op: 'write', path: 'a.ts' }]);
    expect(extractFirstJson('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
  });

  it('strips a ```json fence', () => {
    expect(extractFirstJson('```json\n[{"x":1}]\n```')).toEqual([{ x: 1 }]);
    expect(extractFirstJson('```\n{"y":2}\n```')).toEqual({ y: 2 });
  });

  it('REGRESSION: ignores trailing prose containing a bracket (the silent-no-op bug)', () => {
    // The naive `lastIndexOf(']')` grabbed the `]` in "[thanks]" → JSON.parse threw → null → 0 edits.
    const reply = 'Here are the edits: [{"op":"write","path":"src/App.tsx","content":"x"}]\nLet me know if you need anything else [thanks]';
    expect(extractFirstJson(reply)).toEqual([{ op: 'write', path: 'src/App.tsx', content: 'x' }]);
  });

  it('ignores a stray bracket in LEADING prose and finds the real value', () => {
    const reply = 'See the [docs](https://x.y) first. Then: {"op":"delete","path":"z.ts"}';
    expect(extractFirstJson(reply)).toEqual({ op: 'delete', path: 'z.ts' });
  });

  it('does not let brackets INSIDE string literals fool the balancer', () => {
    const reply = 'ok [{"content":"const a = [1,2]; if (x) { y() }"}] done';
    expect(extractFirstJson(reply)).toEqual([{ content: 'const a = [1,2]; if (x) { y() }' }]);
  });

  it('handles nested arrays/objects', () => {
    expect(extractFirstJson('prefix [{"a":[1,{"b":2}]}] suffix')).toEqual([{ a: [1, { b: 2 }] }]);
  });

  it('returns null when there is no JSON value', () => {
    expect(extractFirstJson('just some prose, no json here')).toBeNull();
    expect(extractFirstJson('')).toBeNull();
    // No opener ever balances to a complete value → null (not a partial/garbage slice).
    expect(extractFirstJson('{"a": [1, 2')).toBeNull();
  });

  it('recovers an inner complete value if an outer bracket is left unclosed', () => {
    // Robustness: a truncated outer array still yields its complete inner object rather than nothing.
    expect(extractFirstJson('[{"a":1}')).toEqual({ a: 1 });
  });

  it('picks the first complete value when several are present', () => {
    expect(extractFirstJson('{"first":1} then {"second":2}')).toEqual({ first: 1 });
  });
});
