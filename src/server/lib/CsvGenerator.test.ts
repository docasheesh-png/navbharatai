import { describe, it, expect } from 'vitest';
import { generateCsvIntegration } from './CsvGenerator';

describe('generateCsvIntegration', () => {
  const c = generateCsvIntegration();
  const server = c.files['server/lib/csv.ts'];

  it('emits a toCsv + parseCsv helper built on papaparse', () => {
    expect(server).toContain("import Papa from 'papaparse'");
    expect(server).toContain('export function toCsv(');
    expect(server).toContain('export function parseCsv<T = CsvRow>(');
    expect(server).toContain('Papa.unparse(');
    expect(server).toContain('Papa.parse<T>(');
    expect(c.files['src/lib/csv.ts']).toBeUndefined(); // server-side
  });

  it('parses with a header row and fails loudly on a malformed CSV', () => {
    expect(server).toContain('header: true');
    expect(server).toContain('skipEmptyLines: true');
    expect(server).toContain('result.errors.length > 0');
    expect(server).toContain('throw new Error(');
  });

  it('serializes with Excel-friendly newlines and lets Papa quote per-field (RFC 4180)', () => {
    expect(server).toContain("newline: '\\r\\n'");
    expect(server).toContain('fields: columns');
  });

  it('declares papaparse, no env keys, no .env.example', () => {
    expect(c.dependency).toEqual({ name: 'papaparse', version: '^5.4.1' });
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/csv.ts']);
    expect(c.instructions.toLowerCase()).toContain('import');
  });
});
