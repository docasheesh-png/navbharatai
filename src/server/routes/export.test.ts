import { describe, it, expect } from 'vitest';
import { toCsv, parseFormat, toXlsxBuffer } from './export';

describe('parseFormat', () => {
  it('defaults to csv and passes through json/xlsx', () => {
    expect(parseFormat(undefined)).toBe('csv');
    expect(parseFormat('bogus')).toBe('csv');
    expect(parseFormat('json')).toBe('json');
    expect(parseFormat('xlsx')).toBe('xlsx');
  });
});

describe('toCsv', () => {
  it('emits a header row from the union of keys, then one row per record', () => {
    const csv = toCsv([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    expect(csv).toBe('a,b\r\n1,2\r\n3,4');
  });

  it('returns just the header row when given rows but includes every key seen', () => {
    // differing shapes → header is the union, missing cells are blank
    const csv = toCsv([{ a: 1 }, { b: 2 }]);
    expect(csv).toBe('a,b\r\n1,\r\n,2');
  });

  it('returns an empty string for no rows (no headers to infer)', () => {
    expect(toCsv([])).toBe('');
  });

  it('RFC-4180 escapes commas, quotes and newlines', () => {
    const csv = toCsv([{ text: 'a,b', quote: 'she said "hi"', multi: 'line1\nline2' }]);
    expect(csv).toBe('text,quote,multi\r\n"a,b","she said ""hi""","line1\nline2"');
  });

  it('renders null/undefined as empty cells', () => {
    expect(toCsv([{ a: null, b: undefined, c: 0 }])).toBe('a,b,c\r\n,,0');
  });
});

describe('toXlsxBuffer', () => {
  it('produces a non-empty .xlsx (ZIP) buffer', () => {
    const buf = toXlsxBuffer([{ id: 'b1', costInr: 5 }], 'build-history');
    expect(buf.length).toBeGreaterThan(0);
    // .xlsx is a ZIP → starts with the "PK" signature
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
