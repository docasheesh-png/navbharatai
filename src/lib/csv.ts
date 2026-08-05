/**
 * CSV, read and written properly (ROADMAP #1 Phase 2.5).
 *
 * Splitting on commas is wrong for real files and the failure is silent: a row containing
 * `"Sharma, Arjun"` becomes two columns, every field after it shifts left, and the data imports
 * "successfully" into the wrong columns. Nobody notices until much later. So this is a scanner that
 * implements RFC 4180 — quoted fields, commas and newlines inside quotes, doubled quotes as an
 * escape — plus the two things real files actually carry: CRLF endings and a UTF-8 BOM.
 *
 * THE ONE DECISION THAT CHANGES DATA. An empty cell can honestly mean two different things, and
 * guessing corrupts a database:
 *
 *     a,,c        →  the middle value is MISSING  → null
 *     a,"",c      →  the middle value is an EMPTY STRING → ''
 *
 * That is exactly how Postgres's own `COPY … WITH CSV` reads it, so a file exported from psql or
 * pgAdmin round-trips through this unchanged. `toCsv` writes the same distinction back out, so
 * exporting and re-importing a table does not quietly turn every null into an empty string.
 */

/** A parsed cell: text, or null for a genuinely absent value. */
export type CsvValue = string | null;

export interface ParsedCsv {
  headers: string[];
  rows: CsvValue[][];
}

/**
 * Parse a CSV document.
 *
 * Never throws — a malformed file (an unterminated quote, a short row) yields the best honest reading
 * rather than an exception, because the caller's job is to show the user what was understood and let
 * them decide, not to hand them a stack trace.
 */
export function parseCsv(text: string, delimiter = ','): ParsedCsv {
  const src = stripBom(String(text ?? ''));
  const rows: CsvValue[][] = [];
  let row: CsvValue[] = [];
  let field = '';
  let quoted = false;      // is the CURRENT field a quoted one?
  let inQuotes = false;
  let started = false;     // has any character (or quote) been seen for this field?
  let i = 0;

  const endField = () => {
    // An unquoted empty field is a missing value; a quoted one is a real empty string.
    row.push(!started ? null : quoted || field.length > 0 ? field : null);
    field = '';
    quoted = false;
    started = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }

    if (ch === '"') { inQuotes = true; quoted = true; started = true; i++; continue; }
    if (ch === delimiter) { endField(); started = false; i++; continue; }
    if (ch === '\r') {
      // CRLF or a lone CR — both end the record.
      endRow();
      i += src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') { endRow(); i++; continue; }

    field += ch;
    started = true;
    i++;
  }
  // A file ending with a newline has no trailing empty record; one ending mid-field does.
  if (started || field.length > 0 || row.length > 0) endRow();

  const headerRow = rows.shift() ?? [];
  const headers = headerRow.map((h, idx) => String(h ?? '').trim() || `column_${idx + 1}`);
  return { headers, rows: rows.filter((r) => !isBlankRow(r)) };
}

/**
 * Is this record an artefact of a trailing newline rather than data?
 *
 * ONLY a single, unquoted, empty field counts — that is exactly what a blank line produces. A record
 * with two or more fields is a real row even when every value in it is empty, and an earlier version
 * of this function dropped those: a row of `null, ''` (which `toCsv` writes as `,""`) vanished on
 * re-import. Losing a row silently is worse than any parse error, because nothing reports it.
 */
function isBlankRow(row: CsvValue[]): boolean {
  return row.length <= 1 && (row.length === 0 || row[0] === null);
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Pair each row with the headers, as an object per row.
 *
 * A short row is padded with nulls and a long one is truncated, rather than either being rejected:
 * real exports are ragged, and refusing the whole file over one uneven line helps nobody. The count
 * of adjusted rows is returned so the caller can say so instead of importing silently.
 */
export function rowsToObjects(parsed: ParsedCsv): { rows: Array<Record<string, CsvValue>>; adjusted: number } {
  const out: Array<Record<string, CsvValue>> = [];
  let adjusted = 0;
  for (const row of parsed.rows) {
    if (row.length !== parsed.headers.length) adjusted++;
    const obj: Record<string, CsvValue> = {};
    parsed.headers.forEach((h, idx) => { obj[h] = idx < row.length ? row[idx] : null; });
    out.push(obj);
  }
  return { rows: out, adjusted };
}

/**
 * One CSV field, escaped only when it has to be.
 *
 * Quoting everything would be simpler and would also destroy the null/empty-string distinction on the
 * way out — a null must leave as an EMPTY field, never as `""`, or a re-import turns every missing
 * value into an empty string.
 */
export function csvField(value: unknown, delimiter = ','): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'object') {
    try { text = JSON.stringify(value); } catch { text = String(value); }
  } else {
    text = String(value);
  }
  // An empty string MUST be quoted, or it would read back as a null.
  const needsQuotes = text === '' || text.includes(delimiter) || text.includes('"') || /[\r\n]/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Render rows as CSV, with a header line. CRLF, because that is what RFC 4180 and Excel expect. */
export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[], delimiter = ','): string {
  const cols = columns && columns.length
    ? columns
    : [...new Set((rows ?? []).flatMap((r) => (r && typeof r === 'object' ? Object.keys(r) : [])))];
  const lines = [cols.map((c) => csvField(c, delimiter)).join(delimiter)];
  for (const row of rows ?? []) {
    lines.push(cols.map((c) => csvField(row?.[c], delimiter)).join(delimiter));
  }
  return lines.join('\r\n');
}

/**
 * Which CSV headers can actually be imported into this table.
 *
 * Unknown columns are reported, never silently dropped: a file whose `e-mail` column does not match
 * the table's `email` would otherwise import every row with that field missing and call it a success.
 */
export function matchColumns(headers: string[], tableColumns: string[]): { usable: string[]; unknown: string[] } {
  const known = new Set(tableColumns ?? []);
  const usable: string[] = [];
  const unknown: string[] = [];
  for (const h of headers ?? []) (known.has(h) ? usable : unknown).push(h);
  return { usable, unknown };
}
