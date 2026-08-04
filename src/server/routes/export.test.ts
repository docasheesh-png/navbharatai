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
  it('produces a non-empty .xlsx (ZIP) buffer', async () => {
    const buf = await toXlsxBuffer([{ id: 'b1', costInr: 5 }], 'build-history');
    expect(buf.length).toBeGreaterThan(0);
    // .xlsx is a ZIP → starts with the "PK" signature
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  // ROUND-TRIP: the migration off SheetJS (frozen at a prototype-pollution CVE on npm) must not
  // quietly change what lands in the user's spreadsheet. Reading the file back is the only check that
  // proves it — "the buffer is a ZIP" would pass for an empty workbook too.
  it('writes the real headers and values, readable back', async () => {
    const buf = await toXlsxBuffer([{ id: 'b1', costInr: 5 }, { id: 'b2', costInr: 12 }], 'usage');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('usage');
    expect(ws).toBeTruthy();
    expect(ws!.getRow(1).values).toEqual([undefined, 'id', 'costInr']);
    expect(ws!.getRow(2).values).toEqual([undefined, 'b1', 5]);
    expect(ws!.getRow(3).values).toEqual([undefined, 'b2', 12]);
    // Numbers must stay NUMBERS, or every cost column arrives as text and no sum works in Excel.
    expect(typeof ws!.getRow(2).getCell(2).value).toBe('number');
  });

  it('unions differing row shapes, matching toCsv', async () => {
    // The same export must not disagree with itself depending on which button the user pressed.
    const rows = [{ a: 1 }, { b: 2 }];
    const buf = await toXlsxBuffer(rows, 'Export');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Export')!.getRow(1).values).toEqual([undefined, 'a', 'b']);
    expect(toCsv(rows).split('\r\n')[0]).toBe('a,b');
  });

  it('sanitises a sheet name Excel would refuse to open', async () => {
    // Over 31 chars AND containing illegal characters — either one yields a file Excel rejects,
    // i.e. a "successful" export the user cannot open.
    const buf = await toXlsxBuffer([{ a: 1 }], 'build/history:2026*report[final]-with-a-very-long-tail');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const name = wb.worksheets[0].name;
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[*?:\\/\[\]]/);
  });

  it('handles an empty export without producing a broken file', async () => {
    const buf = await toXlsxBuffer([], 'Export');
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
