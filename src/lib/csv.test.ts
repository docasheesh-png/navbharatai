import { describe, it, expect } from 'vitest';
import { parseCsv, rowsToObjects, csvField, toCsv, matchColumns } from './csv';

describe('parseCsv — the failures of a naive comma split are silent, which is why they matter', () => {
  it('reads a plain file', () => {
    const r = parseCsv('a,b\n1,2\n3,4');
    expect(r.headers).toEqual(['a', 'b']);
    expect(r.rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('keeps a comma inside quotes in ONE field', () => {
    // Split on commas and this becomes two columns; every field after it shifts left and the data
    // imports "successfully" into the wrong columns.
    const r = parseCsv('name,city\n"Sharma, Arjun",Delhi');
    expect(r.rows[0]).toEqual(['Sharma, Arjun', 'Delhi']);
  });

  it('keeps a NEWLINE inside quotes in one field', () => {
    const r = parseCsv('a,b\n"line1\nline2",x');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0][0]).toBe('line1\nline2');
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('a\n"say ""hi"""').rows[0][0]).toBe('say "hi"');
  });

  it('handles CRLF endings and a UTF-8 BOM', () => {
    const r = parseCsv('﻿a,b\r\n1,2\r\n');
    expect(r.headers).toEqual(['a', 'b']);
    expect(r.rows).toEqual([['1', '2']]);
  });

  it('distinguishes a MISSING value from an EMPTY STRING — the decision that changes data', () => {
    // Exactly how Postgres COPY … WITH CSV reads it, so a psql export round-trips unchanged.
    const r = parseCsv('a,b,c\n1,,3\n4,"",6');
    expect(r.rows[0]).toEqual(['1', null, '3']);   // a,,c  → missing
    expect(r.rows[1]).toEqual(['4', '', '6']);     // a,"",c → empty string
  });

  it('drops trailing blank lines rather than importing empty rows', () => {
    expect(parseCsv('a,b\n1,2\n\n\n').rows).toEqual([['1', '2']]);
  });

  it('names an unnamed header column instead of producing an empty key', () => {
    expect(parseCsv('a,,c\n1,2,3').headers).toEqual(['a', 'column_2', 'c']);
  });

  it('never throws on a malformed file — it reads what it can', () => {
    expect(() => parseCsv('a,b\n"unterminated,2')).not.toThrow();
    expect(parseCsv('').rows).toEqual([]);
    expect(parseCsv('a,b').rows).toEqual([]);
  });

  it('supports another delimiter when asked', () => {
    expect(parseCsv('a;b\n1;2', ';').rows).toEqual([['1', '2']]);
  });
});

describe('rowsToObjects — ragged files are common, and refusing them helps nobody', () => {
  it('pairs each row with the headers', () => {
    const r = rowsToObjects(parseCsv('a,b\n1,2'));
    expect(r.rows).toEqual([{ a: '1', b: '2' }]);
    expect(r.adjusted).toBe(0);
  });

  it('pads a short row and truncates a long one, and COUNTS that it did', () => {
    // Counted so the caller can say so, rather than importing something adjusted in silence.
    const r = rowsToObjects(parseCsv('a,b,c\n1,2\n1,2,3,4'));
    expect(r.rows[0]).toEqual({ a: '1', b: '2', c: null });
    expect(r.rows[1]).toEqual({ a: '1', b: '2', c: '3' });
    expect(r.adjusted).toBe(2);
  });
});

describe('csvField — quoting only where it is required', () => {
  it('quotes what must be quoted and leaves the rest alone', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('has,comma')).toBe('"has,comma"');
    expect(csvField('has"quote')).toBe('"has""quote"');
    expect(csvField('has\nnewline')).toBe('"has\nnewline"');
  });

  it('writes null as an EMPTY field and an empty string as ""', () => {
    // Quoting everything would be simpler and would destroy the distinction: a re-import would turn
    // every missing value into an empty string.
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField('')).toBe('""');
  });

  it('writes objects as JSON rather than [object Object]', () => {
    expect(csvField({ a: 1 })).toBe('"{""a"":1}"');
  });

  it('keeps falsy scalars — 0 and false are data', () => {
    expect(csvField(0)).toBe('0');
    expect(csvField(false)).toBe('false');
  });
});

describe('toCsv', () => {
  it('writes a header line and CRLF records', () => {
    expect(toCsv([{ a: 1, b: 2 }])).toBe('a,b\r\n1,2');
  });

  it('follows the caller\'s column order when given one', () => {
    expect(toCsv([{ a: 1, b: 2 }], ['b', 'a'])).toBe('b,a\r\n2,1');
  });

  it('unions keys across rows, so a column absent from row 1 is not lost', () => {
    expect(toCsv([{ a: 1 }, { a: 2, b: 3 }])).toBe('a,b\r\n1,\r\n2,3');
  });

  it('round-trips a null and an empty string back to themselves', () => {
    // The whole point of the quoting rules above.
    const csv = toCsv([{ a: null, b: '' }]);
    expect(rowsToObjects(parseCsv(csv)).rows[0]).toEqual({ a: null, b: '' });
  });

  it('round-trips a value containing a comma, a quote and a newline', () => {
    const original = { note: 'Sharma, "A"\nsecond line' };
    expect(rowsToObjects(parseCsv(toCsv([original]))).rows[0]).toEqual(original);
  });
});

describe('matchColumns — an unknown header is reported, never dropped', () => {
  it('separates what the table has from what it does not', () => {
    // A file whose "e-mail" column does not match the table's "email" would otherwise import every
    // row with that field missing and call it a success.
    const r = matchColumns(['id', 'e-mail'], ['id', 'email']);
    expect(r.usable).toEqual(['id']);
    expect(r.unknown).toEqual(['e-mail']);
  });

  it('handles empty input without throwing', () => {
    expect(matchColumns([], [])).toEqual({ usable: [], unknown: [] });
  });
});

describe('a row of empty values is DATA, not a blank line', () => {
  // Regression: an earlier isBlankRow dropped any row whose values were all empty, so a genuine
  // `null, ''` row written by toCsv vanished on re-import. A silently lost row is worse than a parse
  // error, because nothing reports it.
  it('keeps a multi-field row even when every value is empty', () => {
    expect(parseCsv('a,b\n,\n').rows).toEqual([[null, null]]);
    expect(parseCsv('a,b\n,""\n').rows).toEqual([[null, '']]);
  });

  it('still drops the record a trailing newline produces', () => {
    expect(parseCsv('a,b\n1,2\n').rows).toEqual([['1', '2']]);
    expect(parseCsv('a,b\n1,2\n\n\n').rows).toEqual([['1', '2']]);
  });
});
