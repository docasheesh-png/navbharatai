// U-4 (verified recipe modules) — CSV import/export (papaparse).
//
// "Export to CSV" and "import a CSV" are among the most common real needs in business apps — export a
// report/table for Excel, bulk-import products/contacts/orders from an uploaded file. Naive split-on-comma
// breaks the moment a field contains a comma, a quote, or a newline; this recipe uses `papaparse` (the
// standard) so quoting/escaping/embedded-newline handling is RFC-4180 correct by construction — the
// root-cause-quality choice, not a hand-rolled splitter that silently corrupts data. Adds a real SERVER
// helper: `toCsv(rows)` to serialize and `parseCsv(text)` to read back. PURE builder; the generated code is
// correct and complete — no TODO stubs (the real-features rule). Introduces no env keys. Unit-tested.

export interface CsvConfig {
  files: Record<string, string>;
  /** papaparse is the one dependency (the standard, RFC-4180-correct CSV parser/serializer). */
  dependency: { name: string; version: string };
  instructions: string;
}

const CSV_SERVER = `import Papa from 'papaparse';

export type CsvRow = Record<string, unknown>;

// Serialize an array of objects to a CSV string. Header row is derived from the keys (or pass \`columns\` to
// fix the order / subset). Commas, quotes and newlines inside values are escaped correctly (RFC 4180), so
// the output opens cleanly in Excel/Sheets. Stream it as a download:
//   res.type('text/csv').set('Content-Disposition', 'attachment; filename="report.csv"').send(toCsv(rows));
export function toCsv(rows: CsvRow[], columns?: string[]): string {
  return Papa.unparse(columns ? { fields: columns, data: rows.map((r) => columns.map((c) => r[c])) } : rows, {
    quotes: false, // only quote when needed (commas/quotes/newlines) — Papa decides per-field
    newline: '\\r\\n', // Excel-friendly line endings
  });
}

// Parse a CSV string (e.g. an uploaded file's text) into an array of objects keyed by the header row.
// Numeric and boolean cells are coerced (dynamicTyping). Throws on a malformed CSV so a bad upload fails
// loudly instead of importing garbage. Empty lines are skipped.
export function parseCsv<T = CsvRow>(text: string): T[] {
  const result = Papa.parse<T>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });
  if (result.errors.length > 0) {
    const first = result.errors[0];
    throw new Error('CSV parse error at row ' + (first.row ?? '?') + ': ' + first.message);
  }
  return result.data;
}
`;

const INSTRUCTIONS =
  'CSV import/export wired at server/lib/csv.ts (add the dependency papaparse). Import toCsv(rows) to turn ' +
  'an array of objects into an Excel-ready CSV string (stream it as a download with a text/csv + ' +
  "Content-Disposition header), or parseCsv(uploadedText) to read an uploaded CSV back into objects. " +
  'Quoting/escaping of commas, quotes and newlines is RFC-4180 correct, so data never corrupts. Great for ' +
  'report export, bulk product/contact/order import and data migration. No API key needed.';

export function generateCsvIntegration(): CsvConfig {
  return {
    files: { 'server/lib/csv.ts': CSV_SERVER },
    dependency: { name: 'papaparse', version: '^5.4.1' },
    instructions: INSTRUCTIONS,
  };
}
