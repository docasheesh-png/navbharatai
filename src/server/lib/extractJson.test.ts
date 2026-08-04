import { describe, it, expect } from 'vitest';
import { extractFirstJsonSlice, extractFirstJson } from './extractJson';

// Locks the robust JSON extractor that pulls a model's JSON out of arbitrary prose. The whole reason it
// exists is the naive `indexOf('{')…lastIndexOf('}')` trap: a stray bracket in leading/trailing prose used
// to make JSON.parse throw and the caller silently got NOTHING (every edit dropped → a no-op build turn).
// These tests encode exactly those trap cases so the fix can never regress.

describe('extractFirstJsonSlice — fast path', () => {
  it('returns whole text when it is already valid JSON of any kind', () => {
    expect(extractFirstJsonSlice('{"a":1}')).toBe('{"a":1}');
    expect(extractFirstJsonSlice('[1,2,3]')).toBe('[1,2,3]');
    expect(extractFirstJsonSlice('  {"a":1}  ')).toBe('{"a":1}'); // trimmed
  });

  it('strips a ```json fence before parsing', () => {
    expect(extractFirstJsonSlice('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractFirstJsonSlice('```\n[1,2]\n```')).toBe('[1,2]');
  });
});

describe('extractFirstJsonSlice — the lastIndexOf trap (leading/trailing prose with brackets)', () => {
  it('ignores trailing prose that contains a bracket (a markdown link / checkbox)', () => {
    expect(extractFirstJsonSlice('{"a":1}\n\nLet me know if [this helps](http://x)')).toBe('{"a":1}');
    expect(extractFirstJsonSlice('[1,2,3]  thanks [x]', 'array')).toBe('[1,2,3]');
  });

  it('skips a stray bracket in LEADING prose and finds the real value', () => {
    expect(extractFirstJsonSlice('see [docs](url) then {"a":1} ok')).toBe('{"a":1}');
    // '[x]' is balanced but NOT valid JSON, so it is skipped and the real array is found. (Note '[ ]'
    // WOULD be a valid empty array and legitimately match first — this uses a non-parseable leading bracket.)
    expect(extractFirstJsonSlice('note [x] then [1,2] end', 'array')).toBe('[1,2]');
  });

  it('is string/escape aware — a bracket INSIDE a JSON string never moves the depth', () => {
    expect(extractFirstJsonSlice('{"msg":"a } b ] c"}')).toBe('{"msg":"a } b ] c"}');
    expect(extractFirstJsonSlice('{"q":"he said \\"} hi ]\\""}')).toBe('{"q":"he said \\"} hi ]\\""}');
  });

  it('handles nested structures', () => {
    const raw = 'result: {"a":{"b":[1,2]},"c":"}"} done';
    expect(extractFirstJsonSlice(raw)).toBe('{"a":{"b":[1,2]},"c":"}"}');
  });
});

describe('extractFirstJsonSlice — kind restriction', () => {
  it("kind 'array' returns only an array, skipping a leading object", () => {
    expect(extractFirstJsonSlice('{"a":1} then [1,2]', 'array')).toBe('[1,2]');
    expect(extractFirstJsonSlice('{"a":1}', 'array')).toBeNull(); // no array present
  });

  it("kind 'object' returns only an object, skipping a leading array", () => {
    expect(extractFirstJsonSlice('[1,2] then {"a":1}', 'object')).toBe('{"a":1}');
    expect(extractFirstJsonSlice('[1,2,3]', 'object')).toBeNull();
  });

  it("kind 'any' returns whichever complete value comes first", () => {
    expect(extractFirstJsonSlice('x [1] y {"a":1}', 'any')).toBe('[1]');
    expect(extractFirstJsonSlice('x {"a":1} y [1]', 'any')).toBe('{"a":1}');
  });
});

describe('extractFirstJsonSlice — no valid JSON', () => {
  it('returns null for unbalanced / absent / empty input', () => {
    expect(extractFirstJsonSlice('{"a":1')).toBeNull(); // never closes
    expect(extractFirstJsonSlice('just prose, no json')).toBeNull();
    expect(extractFirstJsonSlice('')).toBeNull();
    expect(extractFirstJsonSlice(null as unknown as string)).toBeNull();
    expect(extractFirstJsonSlice('[docs]')).toBeNull(); // balanced but not valid JSON
  });
});

describe('extractFirstJson — parsed value', () => {
  it('returns the parsed value, not the string', () => {
    expect(extractFirstJson('prefix {"a":1,"b":[2,3]} suffix')).toEqual({ a: 1, b: [2, 3] });
    expect(extractFirstJson('[1,2,3]', 'array')).toEqual([1, 2, 3]);
  });

  it('returns null when nothing of the requested kind parses', () => {
    expect(extractFirstJson('no json here')).toBeNull();
    expect(extractFirstJson('{"a":1}', 'array')).toBeNull();
  });
});
